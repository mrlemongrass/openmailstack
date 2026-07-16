import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  MessageSquareText,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { ErrorBanner } from "../shared/components/ErrorBanner";

interface DeliveryProvider {
  id: string;
  tenantKey: string;
  name: string;
  channel: "webhook" | "sms" | "whatsapp" | "voice" | "translation";
  endpointUrl: string;
  authHeaderName: string;
  timeoutSeconds: number;
  allowPrivateNetwork: boolean;
  enabled: boolean;
  hasSecret: boolean;
  lastTestedAt: string | null;
  lastTestStatus: "healthy" | "failed" | null;
  lastTestErrorCode: string | null;
}

interface AdminWorkflowJob {
  id: string;
  tenantKey: string;
  ownerUsername: string;
  workflowName: string;
  jobType: string;
  attempts: number;
  lastErrorCode: string | null;
  deadLetteredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

interface AdminDeliveryAlert {
  id: string;
  tenantKey: string;
  jobId: string;
  severity: string;
  alertType: string;
  errorCode: string | null;
  resolvedAt: string | null;
}

interface SchedulerDeliveryMetrics {
  activeWorkflows: number;
  totalJobs: number;
  queuedJobs: number;
  recoveryJobs: number;
  delivered24h: number;
  openAlerts: number;
}

const emptyMetrics: SchedulerDeliveryMetrics = {
  activeWorkflows: 0,
  totalJobs: 0,
  queuedJobs: 0,
  recoveryJobs: 0,
  delivered24h: 0,
  openAlerts: 0,
};

const providerDisclosure: Record<
  DeliveryProvider["channel"],
  { credentials: string; costs: string }
> = {
  webhook: {
    credentials: "A shared signing secret is required so the receiver can verify every OMS request.",
    costs: "OMS charges nothing; you are responsible for hosting and operating the receiving endpoint.",
  },
  sms: {
    credentials: "Your SMS adapter endpoint and its API credential are required.",
    costs: "The external SMS provider may charge per message, destination, and carrier.",
  },
  whatsapp: {
    credentials: "Your approved WhatsApp adapter endpoint and its API credential are required.",
    costs: "The external provider may charge per conversation or message and may require template approval.",
  },
  voice: {
    credentials: "Your voice adapter endpoint and its API credential are required.",
    costs: "The external provider may charge per call, minute, destination, recording, or transcription.",
  },
  translation: {
    credentials: "Provide the translation adapter credential when that endpoint requires authentication.",
    costs: "The external provider may charge by character, token, or request.",
  },
};

const emptyProvider = {
  tenantKey: "",
  name: "",
  channel: "webhook" as DeliveryProvider["channel"],
  endpointUrl: "",
  authHeaderName: "Authorization",
  secret: "",
  timeoutSeconds: 15,
  allowPrivateNetwork: false,
  enabled: true,
};

const request = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, { credentials: "include", ...options });
  const body = (await response.json()) as {
    success: boolean;
    error?: string;
  } & T;
  if (!response.ok || !body.success)
    throw new Error(body.error || "Scheduler provider request failed");
  return body;
};

export function SchedulerDeliveryPanel() {
  const [providers, setProviders] = useState<DeliveryProvider[]>([]);
  const [jobs, setJobs] = useState<AdminWorkflowJob[]>([]);
  const [alerts, setAlerts] = useState<AdminDeliveryAlert[]>([]);
  const [metrics, setMetrics] = useState<SchedulerDeliveryMetrics>(emptyMetrics);
  const [form, setForm] = useState(emptyProvider);
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    try {
      const [providerResult, operations] = await Promise.all([
        request<{ providers: DeliveryProvider[] }>(
          "/api/admin/scheduler/v1/providers",
        ),
        request<{
          jobs: AdminWorkflowJob[];
          alerts: AdminDeliveryAlert[];
          metrics: SchedulerDeliveryMetrics;
        }>(
          "/api/admin/scheduler/v1/workflow-operations",
        ),
      ]);
      setProviders(providerResult.providers);
      setJobs(operations.jobs);
      setAlerts(operations.alerts);
      setMetrics(operations.metrics);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load providers",
      );
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const edit = (provider: DeliveryProvider) => {
    setEditingId(provider.id);
    setForm({ ...emptyProvider, ...provider, secret: "" });
    setStatus(
      "Secrets are write-only. Leave the field blank to keep the existing credential.",
    );
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await request(
        editingId
          ? `/api/admin/scheduler/v1/providers/${editingId}`
          : "/api/admin/scheduler/v1/providers",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      setEditingId("");
      setForm(emptyProvider);
      setStatus("Delivery provider saved.");
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save provider",
      );
    } finally {
      setBusy(false);
    }
  };

  const disableProvider = async (provider: DeliveryProvider) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await request(`/api/admin/scheduler/v1/providers/${provider.id}`, {
        method: "DELETE",
      });
      setStatus(`${provider.name} disabled.`);
      await load();
    } catch (disableError) {
      setError(
        disableError instanceof Error
          ? disableError.message
          : "Unable to disable provider",
      );
    } finally {
      setBusy(false);
    }
  };

  const test = async (provider: DeliveryProvider) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await request(`/api/admin/scheduler/v1/providers/${provider.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantKey: provider.tenantKey }),
      });
      setStatus(`${provider.name} accepted the test request.`);
      await load();
    } catch (testError) {
      await load().catch(() => undefined);
      setError(
        testError instanceof Error ? testError.message : "Provider test failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async (
    job: AdminWorkflowJob,
    action: "retry" | "delivered" | "cancel",
  ) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await request(
        `/api/admin/scheduler/v1/workflow-operations/${job.id}/reconcile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      setStatus(`${job.workflowName} delivery reconciled: ${action}.`);
      await load();
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : "Unable to reconcile delivery",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-scheduler-delivery">
      <header className="admin-page-header">
        <div>
          <h1>Scheduler delivery</h1>
          <p>
            Connect HTTPS adapters for signed webhooks, messaging, voice, and
            translation workflows, then recover failed deliveries.
          </p>
        </div>
        <ShieldCheck size={24} />
      </header>
      {error && <ErrorBanner error={error} />}
      {status && (
        <div className="admin-success">
          <CheckCircle2 size={16} /> {status}
        </div>
      )}
      <div className="admin-delivery-metrics" aria-label="Scheduler delivery metrics">
        <article><strong>{metrics.activeWorkflows}</strong><span>Active workflows</span></article>
        <article><strong>{metrics.queuedJobs}</strong><span>Queued jobs</span></article>
        <article><strong>{metrics.recoveryJobs}</strong><span>Needs recovery</span></article>
        <article><strong>{metrics.delivered24h}</strong><span>Delivered in 24h</span></article>
      </div>
      <div className="admin-scheduler-delivery-grid">
        <form className="admin-card admin-provider-form" onSubmit={save}>
          <div>
            <h2>{editingId ? "Edit provider" : "Add provider"}</h2>
            <p>Credentials are encrypted and never returned by the API.</p>
          </div>
          <label>
            Tenant domain
            <input
              required
              value={form.tenantKey}
              onChange={(event) =>
                setForm({ ...form, tenantKey: event.target.value })
              }
              placeholder="example.com"
            />
          </label>
          <label>
            Name
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Primary messaging adapter"
            />
          </label>
          <label>
            Channel
            <select
              value={form.channel}
              onChange={(event) =>
                setForm({
                  ...form,
                  channel: event.target.value as DeliveryProvider["channel"],
                })
              }
            >
              <option value="webhook">Signed webhook</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="voice">Voice</option>
              <option value="translation">Translation</option>
            </select>
          </label>
          <label>
            HTTPS endpoint
            <input
              required
              type="url"
              value={form.endpointUrl}
              onChange={(event) =>
                setForm({ ...form, endpointUrl: event.target.value })
              }
              placeholder="https://adapter.example.com/scheduler"
            />
          </label>
          <label>
            Authentication header
            <input
              required
              value={form.authHeaderName}
              onChange={(event) =>
                setForm({ ...form, authHeaderName: event.target.value })
              }
            />
          </label>
          <label>
            {form.channel === "webhook"
              ? "Signing secret"
              : "Credential"}
            <input
              type="password"
              autoComplete="new-password"
              required={!editingId && form.channel === "webhook"}
              value={form.secret}
              onChange={(event) =>
                setForm({ ...form, secret: event.target.value })
              }
              placeholder={
                editingId
                  ? "Leave blank to keep existing"
                  : form.channel === "webhook"
                    ? "Required signing secret"
                    : "Bearer …"
              }
            />
          </label>
          <label>
            Timeout seconds
            <input
              type="number"
              min={2}
              max={30}
              value={form.timeoutSeconds}
              onChange={(event) =>
                setForm({ ...form, timeoutSeconds: Number(event.target.value) })
              }
            />
          </label>
          <label className="admin-provider-check">
            <input
              type="checkbox"
              checked={form.allowPrivateNetwork}
              onChange={(event) =>
                setForm({ ...form, allowPrivateNetwork: event.target.checked })
              }
            />
            <span>
              Allow private-network endpoint
              <small>
                Only enable for a trusted internal adapter. Public DNS targets
                are safer.
              </small>
            </span>
          </label>
          <aside className="admin-provider-disclosure" role="note">
            <strong>Before you enable this provider</strong>
            <span>{providerDisclosure[form.channel].credentials}</span>
            <span>{providerDisclosure[form.channel].costs}</span>
          </aside>
          <label className="admin-provider-check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) =>
                setForm({ ...form, enabled: event.target.checked })
              }
            />
            <span>Provider enabled</span>
          </label>
          <div className="admin-provider-actions">
            {editingId && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setEditingId("");
                  setForm(emptyProvider);
                }}
              >
                Cancel
              </button>
            )}
            <button className="btn btn-primary" disabled={busy}>
              <Plus size={15} /> {editingId ? "Save provider" : "Add provider"}
            </button>
          </div>
        </form>
        <div className="admin-provider-list">
          {providers.length === 0 ? (
            <article className="admin-card admin-provider-empty">
              <MessageSquareText size={24} />
              <h2>No delivery providers</h2>
              <p>
                Email and in-app workflows work without one. Add an adapter only
                for external channels or webhooks.
              </p>
            </article>
          ) : (
            providers.map((provider) => (
              <article className="admin-card" key={provider.id}>
                <header>
                  <div>
                    <h2>{provider.name}</h2>
                    <p>
                      {provider.tenantKey} · {provider.channel}
                    </p>
                  </div>
                  <span className={provider.enabled ? "enabled" : "disabled"}>
                    {provider.enabled ? "Enabled" : "Disabled"}
                  </span>
                </header>
                <div className="admin-provider-identifiers">
                  <span>Provider ID</span>
                  <code>{provider.id}</code>
                  <span>Endpoint</span>
                  <code>{provider.endpointUrl}</code>
                </div>
                <dl>
                  <div>
                    <dt>Credential</dt>
                    <dd>{provider.hasSecret ? "Stored securely" : "None"}</dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd>
                      {provider.allowPrivateNetwork
                        ? "Private allowed"
                        : "Public only"}
                    </dd>
                  </div>
                  <div>
                    <dt>Health</dt>
                    <dd>
                      {provider.lastTestStatus === "healthy"
                        ? "Healthy"
                        : provider.lastTestStatus === "failed"
                          ? `Failed · ${provider.lastTestErrorCode || "provider test"}`
                          : "Not tested"}
                    </dd>
                  </div>
                  <div>
                    <dt>Last tested</dt>
                    <dd>
                      {provider.lastTestedAt
                        ? new Date(provider.lastTestedAt).toLocaleString()
                        : "Never"}
                    </dd>
                  </div>
                </dl>
                <footer>
                  <button
                    className="btn btn-secondary"
                    disabled={busy || !provider.enabled}
                    onClick={() => void test(provider)}
                  >
                    <Send size={15} /> Test
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => edit(provider)}
                  >
                    Edit
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Disable ${provider.name}`}
                    disabled={busy || !provider.enabled}
                    onClick={() => void disableProvider(provider)}
                  >
                    <Trash2 size={15} />
                  </button>
                </footer>
              </article>
            ))
          )}
        </div>
      </div>
      <section className="admin-delivery-operations admin-card">
        <header>
          <div>
            <h2>Delivery operations</h2>
            <p>
              {alerts.filter((alert) => !alert.resolvedAt).length} open alerts
              across all Scheduler tenants.
            </p>
          </div>
        </header>
        {jobs.filter((job) => job.deadLetteredAt).length === 0 ? (
          <p>No deliveries need administrator recovery.</p>
        ) : (
          <div className="admin-delivery-job-list">
            {jobs
              .filter((job) => job.deadLetteredAt)
              .map((job) => (
                <article key={job.id}>
                  <div>
                    <strong>{job.workflowName}</strong>
                    <span>
                      {job.tenantKey} · {job.ownerUsername} · {job.jobType}
                    </span>
                    <code>{job.lastErrorCode || "delivery_failed"}</code>
                  </div>
                  <div className="admin-provider-actions">
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => void reconcile(job, "retry")}
                    >
                      Retry
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => void reconcile(job, "delivered")}
                    >
                      Mark delivered
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => void reconcile(job, "cancel")}
                    >
                      Cancel
                    </button>
                  </div>
                </article>
              ))}
          </div>
        )}
      </section>
      <style>{`
      .admin-page-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; }
      .admin-page-header h1,.admin-page-header p,.admin-card h2,.admin-card p { margin:0; }
      .admin-page-header p,.admin-card p { margin-top:5px; color:var(--text-secondary); font-size:.8rem; }
      .admin-success { display:flex; gap:7px; align-items:center; margin-bottom:12px; padding:10px 12px; border:1px solid color-mix(in srgb,#2f9e67 40%,transparent); border-radius:8px; color:#3ebd80; }
      .admin-delivery-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:16px; }
      .admin-delivery-metrics article { display:grid; gap:3px; padding:12px 14px; border:1px solid var(--border-glass); border-radius:10px; background:var(--surface-color); }
      .admin-delivery-metrics strong { font-size:1.15rem; }
      .admin-delivery-metrics span { color:var(--text-secondary); font-size:.7rem; }
      .admin-scheduler-delivery-grid { display:grid; grid-template-columns:minmax(280px,380px) minmax(0,1fr); gap:16px; align-items:start; }
      .admin-card { padding:18px; border:1px solid var(--border-glass); border-radius:12px; background:var(--surface-color); }
      .admin-provider-form,.admin-provider-list { display:grid; gap:12px; }
      .admin-provider-form label { display:grid; gap:5px; color:var(--text-secondary); font-size:.75rem; }
      .admin-provider-form input,.admin-provider-form select { box-sizing:border-box; width:100%; padding:9px 10px; border:1px solid var(--border-glass); border-radius:7px; background:var(--surface-color); color:var(--text-primary); }
      .admin-provider-check { grid-template-columns:auto 1fr!important; align-items:start; }
      .admin-provider-check input { width:auto; margin-top:3px; }
      .admin-provider-check span { display:grid; color:var(--text-primary); }
      .admin-provider-check small { margin-top:3px; color:var(--text-secondary); }
      .admin-provider-disclosure { display:grid; gap:5px; padding:11px 12px; border:1px solid color-mix(in srgb,var(--accent-color) 35%,var(--border-glass)); border-radius:8px; background:color-mix(in srgb,var(--accent-color) 5%,transparent); font-size:.72rem; }
      .admin-provider-disclosure span { color:var(--text-secondary); }
      .admin-provider-actions { display:flex; justify-content:flex-end; gap:8px; }
      .admin-provider-list article>header,.admin-provider-list article>footer { display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .admin-provider-list article>header span { padding:3px 7px; border-radius:999px; font-size:.65rem; }
      .admin-provider-list article>header span.enabled { background:rgba(47,158,103,.15); color:#3ebd80; }
      .admin-provider-list article>header span.disabled { background:rgba(150,150,150,.12); color:var(--text-secondary); }
      .admin-provider-identifiers { display:grid; gap:4px; margin:14px 0; }
      .admin-provider-identifiers span { color:var(--text-secondary); font-size:.68rem; }
      .admin-provider-identifiers code { display:block; overflow:hidden; color:var(--text-secondary); text-overflow:ellipsis; white-space:nowrap; user-select:all; }
      .admin-provider-list dl { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .admin-provider-list dl div { display:grid; gap:3px; }
      .admin-provider-list dt { color:var(--text-secondary); font-size:.68rem; }
      .admin-provider-list dd { margin:0; font-size:.78rem; }
      .admin-provider-empty { text-align:center; }
      .admin-delivery-operations { margin-top:16px; }
      .admin-delivery-operations>header { display:flex; justify-content:space-between; align-items:flex-start; }
      .admin-delivery-job-list { display:grid; gap:10px; margin-top:14px; }
      .admin-delivery-job-list article { display:flex; justify-content:space-between; gap:14px; padding:12px; border:1px solid var(--border-glass); border-radius:9px; }
      .admin-delivery-job-list article>div:first-child { display:grid; gap:4px; min-width:0; }
      .admin-delivery-job-list span,.admin-delivery-job-list code { color:var(--text-secondary); font-size:.72rem; }
      @media(max-width:850px){.admin-scheduler-delivery-grid{grid-template-columns:1fr}.admin-delivery-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){.admin-delivery-job-list article{display:grid}.admin-delivery-job-list .admin-provider-actions{justify-content:stretch;flex-wrap:wrap}.admin-delivery-job-list button{flex:1}}
    `}</style>
    </section>
  );
}
