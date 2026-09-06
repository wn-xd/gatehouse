// Gatehouse desktop launcher.
//
// Compiled with /target:winexe so Windows marks it as a GUI-subsystem binary:
// double-clicking it opens the app with no console window flashing up behind.
// The launcher's only job is to start the bundled Node runtime on the app
// entry point with the native addon path pinned, then get out of the way.
//
// Everything is resolved relative to the launcher's own location, so the
// installed directory can live anywhere (Program Files, a USB stick, a user's
// home) without configuration.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

static class Launcher
{
    static int Main(string[] args)
    {
        string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);

        string node   = Path.Combine(root, "runtime", "node.exe");
        string entry  = Path.Combine(root, "app", "gui", "dist", "main.js");
        string addon  = Path.Combine(root, "runtime", "webview.win32-x64-msvc.node");

        // Fail with a dialog rather than silently doing nothing: a GUI binary
        // has no console to print to, so an unexplained no-op is the worst
        // possible outcome for someone who just double-clicked an icon.
        if (!File.Exists(node))  return Fail("Missing runtime component:\n" + node);
        if (!File.Exists(entry)) return Fail("Missing application files:\n" + entry);

        var psi = new ProcessStartInfo
        {
            FileName        = node,
            Arguments       = "\"" + entry + "\"",
            UseShellExecute = false,
            CreateNoWindow  = true,
            WorkingDirectory = root,
        };

        // The N-API loader honours this, which lets the addon sit in the
        // install directory instead of inside a node_modules tree.
        if (File.Exists(addon))
            psi.EnvironmentVariables["NAPI_RS_NATIVE_LIBRARY_PATH"] = addon;

        // Pass through any arguments so the launcher can also be used for
        // diagnostics (e.g. --devtools) without a second binary.
        foreach (string arg in args)
            psi.Arguments += " \"" + arg + "\"";

        try
        {
            Process.Start(psi);
            return 0;
        }
        catch (Exception ex)
        {
            return Fail("Could not start Gatehouse:\n\n" + ex.Message);
        }
    }

    static int Fail(string message)
    {
        MessageBox.Show(message, "Gatehouse", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }
}
