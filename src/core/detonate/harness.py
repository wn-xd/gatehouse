#!/usr/bin/env python3
"""
Gatehouse detonation harness — runs INSIDE WSL2, isolated.

Detonates one npm package's install (lifecycle scripts + node-gyp builds)
inside a network namespace with NO route to the real internet, while recording
every piece of behavior that matters as evidence. Nothing real leaves the
machine: the namespace has only loopback, so every outbound connection the
package attempts fails at the kernel and is captured by strace as an IOC — the
C2 endpoint is proven without ever being reached.

Zero third-party deps: standard library + strace only, so the sandbox itself
ships no supply chain. Output is a single JSON document on stdout; all human
logging goes to stderr so the caller can parse stdout cleanly.

Usage:  python3 harness.py <package-spec> <workdir> [npm-bin]
Emits:  {"spec","installExit","evidence":{...},"error"?} as JSON on stdout.
"""
import json
import os
import re
import subprocess
import sys


# Persistence surfaces attackers abuse; a write under any of these is a strong
# malicious indicator, mirroring the ChainDrop persistence vectors.
PERSISTENCE_MARKERS = (
    ".claude/settings.json",
    ".vscode/tasks.json",
    ".bashrc",
    ".zshrc",
    ".profile",
    ".npmrc",
    "crontab",
    "authorized_keys",
)

# Credential paths npm itself never touches — a READ here is always the
# package's doing and always worth flagging.
CREDENTIAL_MARKERS = (
    ".aws/credentials",
    ".ssh/",
    ".docker/config.json",
    ".git-credentials",
    "id_rsa",
    "environ",
)

# npm legitimately reads ~/.npmrc for its own config, so a read alone is not
# evidence — but .npmrc holds the auth token ChainDrop steals, so a read
# reported ALONGSIDE an outbound attempt is the exfil signature. Tracked
# separately and only surfaced when paired with a connection.
NPMRC_MARKER = ".npmrc"

# strace -f prefixes each line with the PID as a bare number + spaces
# ("5804  connect(...")— NOT "[pid 5804]". Both forms exist across versions,
# so tolerate either, plus no prefix at all.
LINE_PREFIX = r'^(?:\[pid\s+\d+\]\s+|\d+\s+)?'

# IPv4 inside a sockaddr: sin_addr=inet_addr("1.2.3.4")
RE_INET4 = re.compile(r'sin_addr=inet_addr\("([0-9.]+)"\)')
# IPv6 inside a sockaddr: inet_pton(AF_INET6, "2001:db8::1", &sin6_addr)
RE_INET6 = re.compile(r'inet_pton\(AF_INET6,\s*"([0-9a-fA-F:]+)"')
# Port: sin_port=htons(443) / sin6_port=htons(80)
RE_PORT = re.compile(r'sin6?_port=htons\((\d+)\)')
# openat(AT_FDCWD, "path", O_FLAGS|...) — path is the quoted group, flags follow
RE_OPEN = re.compile(r'openat?\([^,]+,\s*"((?:[^"\\]|\\.)*)"(?:,\s*([A-Z_|]+))?')
RE_EXEC = re.compile(r'execve\("((?:[^"\\]|\\.)*)"')

LOOPBACK = {"127.0.0.1", "::1", "0.0.0.0", ""}


def is_infra_addr(addr):
    """
    True for WSL/host infrastructure addresses that are not C2 evidence: the
    WSL DNS resolver and RFC1918 private ranges the namespace's own plumbing
    uses. A real C2 target is a public address; private/link-local hits here are
    the sandbox talking to its own host, not the package phoning home.
    """
    if ":" in addr:  # IPv6: link-local fe80::/10 and ULA fc00::/7 are infra
        low = addr.lower()
        return low.startswith("fe8") or low.startswith("fe9") or \
            low.startswith("fea") or low.startswith("feb") or \
            low.startswith("fc") or low.startswith("fd")
    parts = addr.split(".")
    if len(parts) != 4:
        return False
    try:
        a, b = int(parts[0]), int(parts[1])
    except ValueError:
        return False
    if a == 10:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    if a == 192 and b == 168:
        return True
    if a == 169 and b == 254:  # link-local
        return True
    return False

# The fake internet, as a self-contained stdlib script run inside the namespace.
# A UDP DNS server answers every query with 127.0.0.1 (so the package connects
# back to us), and a catch-all TCP server accepts any connection and logs the
# first bytes — capturing the C2 hostname (via the DNS query and any Host/SNI in
# the payload) and exfil attempts. Every captured line goes to a log file the
# harness folds into the evidence report. No third-party deps: this is the
# "DNS sinkhole + fake web services" deliverable at minimum viable size.
SINKHOLE_SRC = r'''
import socket, struct, sys, threading

logf = open(sys.argv[1], "a", buffering=1)

def log(kind, detail):
    logf.write(kind + " " + detail + "\n")

def dns_name(data, off):
    labels = []
    while True:
        n = data[off]; off += 1
        if n == 0: break
        labels.append(data[off:off+n].decode("latin1")); off += n
    return ".".join(labels), off

def dns_server():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.bind(("0.0.0.0", 5353))
    except OSError: return
    while True:
        try: data, addr = s.recvfrom(2048)
        except OSError: break
        try:
            name, off = dns_name(data, 12)
            log("dns", name)
            # minimal A-record answer pointing at loopback
            resp = data[:2] + b"\x81\x80" + data[4:6] + data[4:6] + b"\x00\x00\x00\x00"
            resp += data[12:off+1] + b"\x00\x01\x00\x01"
            resp += b"\xc0\x0c\x00\x01\x00\x01\x00\x00\x00\x3c\x00\x04" + socket.inet_aton("127.0.0.1")
            s.sendto(resp, addr)
        except Exception: pass

def tcp_server():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try: s.bind(("0.0.0.0", 5354))
    except OSError: return
    s.listen(16)
    while True:
        try: conn, _ = s.accept()
        except OSError: break
        threading.Thread(target=handle, args=(conn,), daemon=True).start()

def handle(conn):
    try:
        conn.settimeout(1.0)
        data = conn.recv(512)
        if data:
            head = data.split(b"\r\n")[0].decode("latin1", "replace")
            log("tcp", head[:200])
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
    except Exception: pass
    finally:
        try: conn.close()
        except Exception: pass

threading.Thread(target=dns_server, daemon=True).start()
tcp_server()
'''


def log(msg):
    print(f"[harness] {msg}", file=sys.stderr, flush=True)


def split_spec(spec):
    """Split name@version, honoring scoped names (@scope/name@version)."""
    if spec.startswith("@"):
        second = spec.find("@", 1)
        if second == -1:
            return spec, "latest"
        return spec[:second], spec[second + 1:]
    at = spec.rfind("@")
    if at <= 0:
        return spec, "latest"
    return spec[:at], spec[at + 1:]


def build_project(workdir, spec):
    """
    Write a package.json depending on the target. A registry spec parses as
    name[@version]; a local tarball, path, git, or URL spec is used verbatim as
    the dependency value under a synthetic name, so npm resolves it as-is.
    """
    if spec.startswith("file:") or spec.startswith("git+") or \
            spec.startswith("http://") or spec.startswith("https://"):
        deps = {"gatehouse-target": spec}
    elif spec.startswith("/") or spec.startswith("./") or spec.endswith(".tgz"):
        deps = {"gatehouse-target": f"file:{spec}"}
    else:
        name, version = split_spec(spec)
        deps = {name: version}
    pkg = {
        "name": "gatehouse-detonation",
        "version": "1.0.0",
        "private": True,
        "dependencies": deps,
    }
    with open(os.path.join(workdir, "package.json"), "w") as fh:
        json.dump(pkg, fh)
    return spec

def fetch_deps(workdir, npm_bin):
    """
    Phase 1 (network ON): fetch the package tree into node_modules WITHOUT
    running any lifecycle script (--ignore-scripts). This is the legitimate
    download — separated from detonation so the registry traffic never
    pollutes the C2 evidence. Returns npm's exit code.
    """
    proc = subprocess.run(
        [
            "bash", "-c",
            f"cd {workdir} && {npm_bin} install --ignore-scripts --no-audit "
            f"--no-fund --loglevel=error --allow-git=all --allow-remote=all 2>&1",
        ],
        capture_output=True, text=True, timeout=180,
    )
    log(f"fetch exit={proc.returncode}")
    return proc.returncode, proc.stdout + proc.stderr


def run_isolated(workdir, npm_bin):
    """
    Phase 2 (network OFF): re-run install inside a network namespace with only
    loopback, now WITH scripts allowed. The tree is already on disk, so npm has
    nothing legitimate to fetch — every outbound attempt strace captures here is
    a lifecycle script reaching for its C2, proven without ever being reached.

    A stdlib sinkhole (DNS + catch-all TCP on loopback) plus an nftables
    REDIRECT coaxes the hostname and request line out of the payload; if nft is
    unavailable the redirect no-ops and we still capture destination IPs.
    Returns (exit, output, strace_log, sinkhole_log).
    """
    strace_log = os.path.join(workdir, "strace.log")
    sinkhole_log = os.path.join(workdir, "sinkhole.log")
    sinkhole_py = os.path.join(workdir, "sinkhole.py")
    with open(sinkhole_py, "w") as fh:
        fh.write(SINKHOLE_SRC)

    inner = (
        "ip link set lo up 2>/dev/null; "
        f"python3 {sinkhole_py} {sinkhole_log} & SINK=$!; sleep 0.4; "
        "nft -f - 2>/dev/null <<'NFT' || true\n"
        "table ip gatehouse {\n"
        "  chain out {\n"
        "    type nat hook output priority -100;\n"
        "    udp dport 53 redirect to :5353;\n"
        "    tcp dport != 5354 redirect to :5354;\n"
        "  }\n"
        "}\n"
        "NFT\n"
        f"cd {workdir} && "
        f"strace -f -e trace=network,open,openat,execve,connect,sendto "
        f"-o {strace_log} "
        f"{npm_bin} rebuild --foreground-scripts 2>&1; "
        f"{npm_bin} install --offline --no-audit --no-fund --loglevel=error "
        f"--dangerously-allow-all-scripts --foreground-scripts 2>&1; "
        "kill $SINK 2>/dev/null; true"
    )
    proc = subprocess.run(
        ["unshare", "-n", "bash", "-c", inner],
        capture_output=True,
        text=True,
        timeout=180,
    )
    log(f"detonate exit={proc.returncode}")
    strace = ""
    try:
        with open(strace_log, "r", errors="replace") as fh:
            strace = fh.read()
    except FileNotFoundError:
        pass
    sink = ""
    try:
        with open(sinkhole_log, "r", errors="replace") as fh:
            sink = fh.read()
    except FileNotFoundError:
        pass
    return proc.returncode, proc.stdout + proc.stderr, strace, sink


def parse_evidence(strace, sink=""):
    """Turn a raw strace log into categorized behavioral evidence."""
    connections = set()
    dns_lookups = set()
    http_requests = set()
    files_written = set()
    files_read = set()
    execs = []

    # The sinkhole log records the hostnames the package actually resolved and
    # the request lines it sent to our fake service — the human-readable half of
    # the C2 evidence the raw IPs alone cannot give.
    for raw in sink.splitlines():
        if raw.startswith("dns "):
            dns_lookups.add(raw[4:].strip())
        elif raw.startswith("tcp "):
            http_requests.add(raw[4:].strip())

    for raw in strace.splitlines():
        line = re.sub(LINE_PREFIX, "", raw)

        # Network: connect() and connectionless sendto() carry a sockaddr whose
        # address is recorded even when the call fails (ENETUNREACH under the
        # namespace). Parse the argument, never the return value.
        if line.startswith("connect(") or line.startswith("sendto("):
            port = RE_PORT.search(line)
            m4 = RE_INET4.search(line)
            m6 = RE_INET6.search(line)
            addr = m4.group(1) if m4 else (m6.group(1) if m6 else None)
            if addr is not None and addr not in LOOPBACK and not is_infra_addr(addr):
                connections.add(f"{addr}:{port.group(1)}" if port else addr)
            continue

        if line.startswith("openat(") or line.startswith("open("):
            m = RE_OPEN.search(line)
            if m is None:
                continue
            pathname, flags = m.group(1), (m.group(2) or "")
            if any(w in flags for w in ("O_WRONLY", "O_RDWR", "O_CREAT", "O_APPEND")):
                files_written.add(pathname)
            else:
                files_read.add(pathname)
            continue

        if line.startswith("execve("):
            m = RE_EXEC.search(line)
            if m is not None:
                execs.append(m.group(1))

    def hits(paths, markers):
        out = set()
        for p in paths:
            for mk in markers:
                if mk in p:
                    out.add(p)
                    break
        return sorted(out)

    cred = hits(files_read, CREDENTIAL_MARKERS)
    has_exfil = bool(connections or dns_lookups or http_requests)
    # .npmrc read is npm-normal on its own; only evidence when paired with an
    # outbound attempt (the token-theft-then-exfil signature).
    if has_exfil:
        cred += [p for p in files_read if NPMRC_MARKER in p and "/tmp/" not in p]

    return {
        "outboundConnections": sorted(connections),
        "dnsLookups": sorted(dns_lookups),
        "requestLines": sorted(http_requests),
        "persistenceWrites": hits(files_written, PERSISTENCE_MARKERS),
        "credentialReads": sorted(set(cred)),
        "execCount": len(execs),
        "filesWrittenCount": len(files_written),
        "filesReadCount": len(files_read),
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: harness.py <spec> <workdir> [npm-bin]"}))
        return 2
    spec, workdir = sys.argv[1], sys.argv[2]
    npm_bin = sys.argv[3] if len(sys.argv) > 3 else "npm"
    os.makedirs(workdir, exist_ok=True)

    try:
        build_project(workdir, spec)
        fetch_exit, fetch_out = fetch_deps(workdir, npm_bin)
        if fetch_exit != 0:
            print(json.dumps({
                "spec": spec,
                "error": f"fetch failed (exit {fetch_exit})",
                "installOutputTail": fetch_out[-500:],
            }))
            return 0
        exit_code, install_out, strace, sink = run_isolated(workdir, npm_bin)
        print(json.dumps({
            "spec": spec,
            "installExit": exit_code,
            "evidence": parse_evidence(strace, sink),
            "installOutputTail": install_out[-800:],
        }))
        return 0
    except subprocess.TimeoutExpired:
        print(json.dumps({"spec": spec, "error": "detonation timed out (180s)"}))
        return 0
    except Exception as exc:  # noqa: BLE001 — harness must never crash the caller
        print(json.dumps({"spec": spec, "error": f"{type(exc).__name__}: {exc}"}))
        return 0


if __name__ == "__main__":
    sys.exit(main())
