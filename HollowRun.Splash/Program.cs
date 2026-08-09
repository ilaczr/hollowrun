using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace HollowRun.Splash;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        string? doneFile = null;
        int? parentProcessId = null;

        for (var index = 0; index < args.Length; index++)
        {
            if (args[index].Equals("--done-file", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
            {
                doneFile = args[++index];
            }
            else if (args[index].Equals("--parent-process-id", StringComparison.OrdinalIgnoreCase)
                     && index + 1 < args.Length
                     && int.TryParse(args[++index], out var parsedProcessId))
            {
                parentProcessId = parsedProcessId;
            }
        }

        if (string.IsNullOrWhiteSpace(doneFile) || parentProcessId is null)
        {
            return;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SplashForm(doneFile, parentProcessId.Value));
    }
}

internal sealed class SplashForm : Form
{
    private const int WindowWidth = 520;
    private const int WindowHeight = 200;
    private const int TrackX = 80;
    private const int TrackY = 138;
    private const int TrackWidth = 360;
    private const int TrackHeight = 6;
    private const int SegmentWidth = 112;
    private const double AnimationDurationMilliseconds = 1250;
    private const int MainWindowOverlapMilliseconds = 350;
    private const int StartupFallbackMilliseconds = 5000;

    private static readonly Color WindowBackground = Color.FromArgb(1, 2, 3);
    private static readonly Color WindowBorder = Color.FromArgb(41, 46, 52);
    private static readonly Color PrimaryText = Color.FromArgb(243, 245, 247);
    private static readonly Color TrackBackground = Color.FromArgb(21, 25, 30);
    private static readonly Color Accent = Color.FromArgb(7, 143, 242);

    private readonly string doneFile;
    private readonly int parentProcessId;
    private readonly System.Windows.Forms.Timer animationTimer;
    private readonly System.Windows.Forms.Timer stateTimer;
    private readonly Stopwatch animationClock = Stopwatch.StartNew();
    private readonly DateTime splashStartedAtUtc = DateTime.UtcNow;
    private readonly Font logoFont = new("Segoe UI", 42, FontStyle.Bold, GraphicsUnit.Pixel);
    private readonly Font titleFont = new("Segoe UI", 38, FontStyle.Bold, GraphicsUnit.Pixel);
    private readonly Font statusFont = new("Segoe UI", 12, FontStyle.Regular, GraphicsUnit.Pixel);
    private string status = "Extracting application files...";
    private DateTime? closeAt;
    private DateTime? startupFallbackAt;

    public SplashForm(string doneFile, int parentProcessId)
    {
        this.doneFile = doneFile;
        this.parentProcessId = parentProcessId;

        AutoScaleMode = AutoScaleMode.None;
        BackColor = WindowBackground;
        ClientSize = new Size(WindowWidth, WindowHeight);
        FormBorderStyle = FormBorderStyle.None;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowIcon = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterScreen;
        Text = "HollowRun";
        TopMost = true;

        SetStyle(
            ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer
            | ControlStyles.UserPaint,
            true
        );

        animationTimer = new System.Windows.Forms.Timer { Interval = 16 };
        animationTimer.Tick += (_, _) => Invalidate(
            new Rectangle(TrackX - 2, TrackY - 2, TrackWidth + 4, TrackHeight + 4)
        );

        stateTimer = new System.Windows.Forms.Timer { Interval = 100 };
        stateTimer.Tick += CheckState;

        Shown += (_, _) =>
        {
            TopMost = true;
            BringToFront();
            animationTimer.Start();
            stateTimer.Start();
        };
    }

    protected override CreateParams CreateParams
    {
        get
        {
            const int wsExToolWindow = 0x00000080;
            var parameters = base.CreateParams;
            parameters.ExStyle |= wsExToolWindow;
            return parameters;
        }
    }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        base.OnPaint(eventArgs);

        var graphics = eventArgs.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

        using var borderPen = new Pen(WindowBorder);
        graphics.DrawRectangle(borderPen, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);

        using var textBrush = new SolidBrush(PrimaryText);
        var measurementArea = new SizeF(1000, 100);
        var logoSize = graphics.MeasureString("HR", logoFont, measurementArea, StringFormat.GenericTypographic);
        var titleSize = graphics.MeasureString("HollowRun", titleFont, measurementArea, StringFormat.GenericTypographic);
        const float titleGap = 12;
        var contentWidth = logoSize.Width + titleGap + titleSize.Width;
        var contentX = (ClientSize.Width - contentWidth) / 2;
        DrawGlowingString(graphics, "HR", logoFont, textBrush, contentX, 70);
        DrawGlowingString(
            graphics,
            "HollowRun",
            titleFont,
            textBrush,
            contentX + logoSize.Width + titleGap,
            74
        );

        var trackRectangle = new RectangleF(TrackX, TrackY, TrackWidth, TrackHeight);
        using (var trackPath = CreateRoundedRectangle(trackRectangle, TrackHeight / 2f))
        using (var trackBrush = new SolidBrush(TrackBackground))
        {
            graphics.FillPath(trackBrush, trackPath);
        }

        var phase = animationClock.Elapsed.TotalMilliseconds % AnimationDurationMilliseconds
                    / AnimationDurationMilliseconds;
        var segmentX = TrackX - SegmentWidth + (float)((TrackWidth + SegmentWidth) * phase);
        var segmentRectangle = new RectangleF(segmentX, TrackY, SegmentWidth, TrackHeight);
        var previousClip = graphics.Clip;
        graphics.SetClip(trackRectangle);
        using (var segmentPath = CreateRoundedRectangle(segmentRectangle, TrackHeight / 2f))
        using (var segmentBrush = new SolidBrush(Accent))
        {
            graphics.FillPath(segmentBrush, segmentPath);
        }
        graphics.SetClip(previousClip, CombineMode.Replace);
        previousClip.Dispose();

        graphics.DrawString(status, statusFont, textBrush, TrackX, 152, StringFormat.GenericTypographic);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            animationTimer.Dispose();
            stateTimer.Dispose();
            animationClock.Stop();
            logoFont.Dispose();
            titleFont.Dispose();
            statusFont.Dispose();
        }

        base.Dispose(disposing);
    }

    private void CheckState(object? sender, EventArgs eventArgs)
    {
        if (closeAt is not null)
        {
            if (DateTime.UtcNow >= closeAt.Value)
            {
                Close();
            }
            return;
        }

        if (startupFallbackAt is null && File.Exists(doneFile))
        {
            status = "Starting HollowRun...";
            startupFallbackAt = DateTime.UtcNow.AddMilliseconds(StartupFallbackMilliseconds);
            Invalidate(new Rectangle(TrackX, 150, TrackWidth, 24));
        }

        if (startupFallbackAt is not null)
        {
            if (IsMainApplicationVisible())
            {
                // Keep the topmost splash over the first painted frame briefly so
                // the handoff cannot expose the desktop between both windows.
                closeAt = DateTime.UtcNow.AddMilliseconds(MainWindowOverlapMilliseconds);
                return;
            }

            if (DateTime.UtcNow >= startupFallbackAt.Value)
            {
                Close();
                return;
            }
        }

        try
        {
            using var parentProcess = Process.GetProcessById(parentProcessId);
            if (parentProcess.HasExited)
            {
                Close();
            }
        }
        catch (ArgumentException)
        {
            Close();
        }
    }

    private bool IsMainApplicationVisible()
    {
        foreach (var process in Process.GetProcessesByName("HollowRun"))
        {
            using (process)
            {
                try
                {
                    // Ignore a HollowRun instance that was already open before this
                    // portable launch; wait for the window created by this startup.
                    if (process.HasExited
                        || process.StartTime.ToUniversalTime() < splashStartedAtUtc.AddSeconds(-3))
                    {
                        continue;
                    }

                    process.Refresh();
                    var windowHandle = process.MainWindowHandle;
                    if (windowHandle != IntPtr.Zero && IsWindowVisible(windowHandle))
                    {
                        return true;
                    }
                }
                catch (InvalidOperationException)
                {
                    // The process can exit between enumeration and inspection.
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    // A process that cannot be inspected is not the visible app window.
                }
                catch (NotSupportedException)
                {
                    // Process metadata can be unavailable during teardown.
                }
            }
        }

        return false;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr windowHandle);

    private static void DrawGlowingString(
        Graphics graphics,
        string text,
        Font font,
        Brush foregroundBrush,
        float x,
        float y)
    {
        using var outerGlowBrush = new SolidBrush(Color.FromArgb(18, 255, 255, 255));
        using var innerGlowBrush = new SolidBrush(Color.FromArgb(42, 255, 255, 255));
        var format = StringFormat.GenericTypographic;

        foreach (var offset in new[]
                 {
                     new Point(-3, 0), new Point(3, 0), new Point(0, -3), new Point(0, 3),
                     new Point(-2, -2), new Point(2, -2), new Point(-2, 2), new Point(2, 2)
                 })
        {
            graphics.DrawString(text, font, outerGlowBrush, x + offset.X, y + offset.Y, format);
        }

        foreach (var offset in new[]
                 {
                     new Point(-1, 0), new Point(1, 0), new Point(0, -1), new Point(0, 1),
                     new Point(-1, -1), new Point(1, -1), new Point(-1, 1), new Point(1, 1)
                 })
        {
            graphics.DrawString(text, font, innerGlowBrush, x + offset.X, y + offset.Y, format);
        }

        graphics.DrawString(text, font, foregroundBrush, x, y, format);
    }

    private static GraphicsPath CreateRoundedRectangle(RectangleF rectangle, float radius)
    {
        var diameter = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(rectangle.Left, rectangle.Top, diameter, diameter, 180, 90);
        path.AddArc(rectangle.Right - diameter, rectangle.Top, diameter, diameter, 270, 90);
        path.AddArc(rectangle.Right - diameter, rectangle.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rectangle.Left, rectangle.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}
