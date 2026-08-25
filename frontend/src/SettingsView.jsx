import { Bug, RotateCw, Send, ShieldCheck } from 'lucide-react';

export default function SettingsView({
  settings,
  pendingAction,
  feedback,
  onToggleReports,
  onRestart,
  onTestReport,
  testReportsAvailable
}) {
  const diagnostics = settings?.diagnostics;
  const configured = diagnostics?.reportingConfigured === true;
  const enabled = diagnostics?.autoSendCrashReports === true;
  const active = diagnostics?.reportingActive === true;
  const restartRequired = diagnostics?.restartRequired === true;
  const isBusy = Boolean(pendingAction);
  const status = !settings
    ? 'Loading...'
    : !configured
      ? 'Build setup required'
      : restartRequired
        ? 'Restart required'
        : active
          ? 'Active'
          : 'Off';

  return (
    <section className="settings-page" aria-label="HollowRun settings">
      <div className="settings-card">
        <div className="settings-card-heading">
          <span className="settings-card-icon"><ShieldCheck size={20} /></span>
          <div>
            <h2>Privacy &amp; diagnostics</h2>
            <p>Control whether unexpected application failures are reported.</p>
          </div>
          <span className={`settings-status ${active && !restartRequired ? 'active' : ''}`}>{status}</span>
        </div>

        <div className="settings-row">
          <div className="settings-row-copy">
            <label htmlFor="automatic-crash-reports">Automatically send crash reports</label>
            <p>Disabled by default. A restart applies changes to native crash monitoring.</p>
          </div>
          <button
            type="button"
            id="automatic-crash-reports"
            className={`settings-toggle ${enabled ? 'enabled' : ''}`}
            role="switch"
            aria-checked={enabled}
            aria-label="Automatically send crash reports"
            disabled={!settings || isBusy || (!configured && !enabled)}
            onClick={() => onToggleReports(!enabled)}
          >
            <span aria-hidden="true" />
          </button>
        </div>

        {!configured && settings && (
          <div className="settings-notice warning" role="status">
            Crash reporting has no Sentry destination in this build, so it cannot be enabled yet.
          </div>
        )}

        {restartRequired && (
          <div className="settings-notice" role="status">
            <span>Your preference is saved. Restart HollowRun to {enabled ? 'start' : 'fully stop'} reporting.</span>
            <button type="button" disabled={isBusy} onClick={onRestart}>
              <RotateCw size={14} /> Restart now
            </button>
          </div>
        )}

        {feedback && (
          <div className={`settings-feedback ${feedback.type}`} role="status">
            {feedback.text}
          </div>
        )}

        <div className="settings-report-details">
          <div className="settings-detail-title"><Bug size={15} /> What a report contains</div>
          <p>
            HollowRun sends the app version, Windows and runtime versions, the failing component,
            the error, and its stack trace. Low-level crashes may include one native minidump per run.
          </p>
          <p>
            HollowRun does not deliberately attach Steam identity or library data, custom status text,
            request headers or bodies, cookies, screenshots, activity logs, or local variables. Native
            minidumps can still contain fragments of process memory or local file paths.
          </p>
        </div>

        {testReportsAvailable && (
          <div className="settings-actions">
            <button
              type="button"
              disabled={!active || restartRequired || isBusy}
              title={!active ? 'Enable reporting and restart HollowRun first' : 'Send a test event to Sentry'}
              onClick={onTestReport}
            >
              <Send size={14} /> {pendingAction === 'test' ? 'Sending...' : 'Send test report'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
