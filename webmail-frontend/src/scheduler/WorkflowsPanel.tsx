import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  BellRing,
  Copy,
  Eye,
  Languages,
  Plus,
  RefreshCw,
  Send,
  Workflow,
} from "lucide-react";
import { ErrorBanner } from "../shared/components/ErrorBanner";
import { useToast } from "../shared/components/Toast";
import {
  archiveSchedulerWorkflow,
  cloneSchedulerWorkflow,
  createSchedulerWorkflow,
  dismissSchedulerNotification,
  getSchedulerDeliveryProviders,
  getSchedulerNotifications,
  getSchedulerWorkflowOperations,
  getSchedulerWorkflows,
  previewSchedulerWorkflow,
  publishSchedulerWorkflow,
  markSchedulerNotificationRead,
  reconcileSchedulerWorkflowJob,
  testSchedulerWorkflow,
  translateSchedulerWorkflow,
  updateSchedulerWorkflow,
  type SchedulerAvailableProvider,
  type SchedulerDeliveryAlert,
  type SchedulerEventType,
  type SchedulerInAppNotification,
  type SchedulerWorkflow,
  type SchedulerWorkflowAction,
  type SchedulerWorkflowDefinition,
  type SchedulerWorkflowJob,
  type SchedulerWorkflowTrigger,
} from "./api";

const defaultDefinition = (): SchedulerWorkflowDefinition => ({
  trigger: { type: "booking.start", offsetSeconds: -86400 },
  steps: [
    {
      action: "message.email.reminder",
      delaySeconds: 0,
      config: {
        recipient: "guest",
        subject: "Reminder: {{event.title}}",
        body: "Hello {{booker.name}},\n\nThis is a reminder for {{event.title}} on {{booking.start}}.\n\nManage booking: {{booking.manage_url}}",
      },
    },
  ],
});

const triggerOptions: Array<{
  value: SchedulerWorkflowTrigger;
  label: string;
}> = [
  { value: "booking.start", label: "Meeting start" },
  { value: "booking.ended", label: "Meeting end" },
  { value: "booking.requested", label: "Booking requested" },
  { value: "booking.confirmed", label: "Booking confirmed" },
  { value: "booking.rejected", label: "Booking rejected" },
  { value: "booking.rescheduled", label: "Booking rescheduled" },
  { value: "booking.cancelled", label: "Booking cancelled" },
  { value: "booking.completed", label: "Meeting completed" },
  { value: "booking.no_show", label: "Guest marked no-show" },
];

const actionOptions: Array<{ value: SchedulerWorkflowAction; label: string }> =
  [
    { value: "message.email.reminder", label: "Email reminder" },
    { value: "message.email", label: "Email follow-up" },
    { value: "notification.in_app", label: "In-app notification" },
    { value: "webhook.http", label: "Signed webhook" },
    { value: "message.external", label: "SMS, WhatsApp, or voice" },
  ];

const secondsLabel = (seconds: number) => {
  const absolute = Math.abs(seconds);
  if (absolute % 86400 === 0)
    return `${absolute / 86400} day${absolute === 86400 ? "" : "s"}`;
  if (absolute % 3600 === 0)
    return `${absolute / 3600} hour${absolute === 3600 ? "" : "s"}`;
  return `${Math.round(absolute / 60)} minutes`;
};

export function WorkflowsPanel({ events }: { events: SchedulerEventType[] }) {
  const { showToast } = useToast();
  const [workflows, setWorkflows] = useState<SchedulerWorkflow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [definition, setDefinition] =
    useState<SchedulerWorkflowDefinition>(defaultDefinition);
  const [name, setName] = useState("");
  const [eventTypeIds, setEventTypeIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<SchedulerWorkflowJob[]>([]);
  const [alerts, setAlerts] = useState<SchedulerDeliveryAlert[]>([]);
  const [notifications, setNotifications] = useState<
    SchedulerInAppNotification[]
  >([]);
  const [providers, setProviders] = useState<SchedulerAvailableProvider[]>([]);
  const [translationProviderId, setTranslationProviderId] = useState("");
  const [translationLocales, setTranslationLocales] = useState("es");
  const [mode, setMode] = useState<"builder" | "operations">("builder");
  const [preview, setPreview] = useState<Array<Record<string, string>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextWorkflows, operations, nextProviders, nextNotifications] =
        await Promise.all([
          getSchedulerWorkflows(),
          getSchedulerWorkflowOperations(),
          getSchedulerDeliveryProviders(),
          getSchedulerNotifications(),
        ]);
      setWorkflows(nextWorkflows);
      setJobs(operations.jobs);
      setAlerts(operations.alerts);
      setProviders(nextProviders);
      setNotifications(nextNotifications);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load workflow automation",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const selected = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedId) || null,
    [selectedId, workflows],
  );

  const selectWorkflow = (workflow: SchedulerWorkflow) => {
    setSelectedId(workflow.id);
    setName(workflow.name);
    setEventTypeIds(workflow.eventTypeIds);
    setDefinition(workflow.definition || defaultDefinition());
    setPreview([]);
    setMode("builder");
  };

  const createWorkflow = async () => {
    setBusy(true);
    setError("");
    try {
      const proposed = "Untitled workflow";
      const created = await createSchedulerWorkflow(proposed, []);
      await load();
      setSelectedId(created.id);
      setName(proposed);
      setEventTypeIds([]);
      setDefinition(defaultDefinition());
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create workflow",
      );
    } finally {
      setBusy(false);
    }
  };

  const cloneWorkflow = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const cloned = await cloneSchedulerWorkflow(selected.id);
      await load();
      setSelectedId(cloned.id);
      setName(`Copy of ${name}`.slice(0, 160));
      setEventTypeIds([...eventTypeIds]);
      setDefinition(structuredClone(definition));
      showToast({
        type: "success",
        message: "Workflow cloned as a disabled draft",
      });
    } catch (cloneError) {
      setError(
        cloneError instanceof Error
          ? cloneError.message
          : "Unable to clone workflow",
      );
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await updateSchedulerWorkflow(selected.id, { name, eventTypeIds });
      await publishSchedulerWorkflow(selected.id, definition);
      await load();
      showToast({ type: "success", message: "Workflow version published" });
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Unable to publish workflow",
      );
    } finally {
      setBusy(false);
    }
  };

  const updateStep = (
    index: number,
    patch: Partial<SchedulerWorkflowDefinition["steps"][number]>,
  ) => {
    setDefinition({
      ...definition,
      steps: definition.steps.map((step, itemIndex) =>
        itemIndex === index ? { ...step, ...patch } : step,
      ),
    });
  };

  const updateConfig = (index: number, patch: Record<string, unknown>) => {
    updateStep(index, {
      config: { ...definition.steps[index].config, ...patch },
    });
  };

  const reconcile = async (
    jobId: string,
    action: "retry" | "delivered" | "cancel",
  ) => {
    setBusy(true);
    setError("");
    try {
      await reconcileSchedulerWorkflowJob(jobId, action);
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

  const markNotificationRead = async (notificationId: string) => {
    setBusy(true);
    setError("");
    try {
      await markSchedulerNotificationRead(notificationId);
      await load();
    } catch (notificationError) {
      setError(
        notificationError instanceof Error
          ? notificationError.message
          : "Unable to mark notification read",
      );
    } finally {
      setBusy(false);
    }
  };

  const dismissNotification = async (notificationId: string) => {
    setBusy(true);
    setError("");
    try {
      await dismissSchedulerNotification(notificationId);
      await load();
    } catch (notificationError) {
      setError(
        notificationError instanceof Error
          ? notificationError.message
          : "Unable to dismiss notification",
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleWorkflow = async (enabled: boolean) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await updateSchedulerWorkflow(selected.id, { enabled });
      await load();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update workflow",
      );
    } finally {
      setBusy(false);
    }
  };

  const archiveWorkflow = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await archiveSchedulerWorkflow(selected.id);
      setSelectedId("");
      await load();
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "Unable to archive workflow",
      );
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await testSchedulerWorkflow(selected.id);
      const skipped = result.skippedActions.length
        ? ` Provider steps (${Array.from(new Set(result.skippedActions)).join(", ")}) use the administrator adapter test.`
        : "";
      showToast({
        type: "success",
        message: `${result.jobIds.length} safe test action${result.jobIds.length === 1 ? "" : "s"} queued.${skipped}`,
      });
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : "Unable to queue test send",
      );
    } finally {
      setBusy(false);
    }
  };

  const generateTranslations = async () => {
    const locales = translationLocales
      .split(",")
      .map((locale) => locale.trim())
      .filter(Boolean);
    if (!translationProviderId || !locales.length) {
      setError("Choose a translation provider and at least one locale.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDefinition(
        await translateSchedulerWorkflow(
          definition,
          translationProviderId,
          locales,
        ),
      );
      showToast({
        type: "success",
        message: "Translations generated and retained in this draft",
      });
    } catch (translationError) {
      setError(
        translationError instanceof Error
          ? translationError.message
          : "Unable to generate translations",
      );
    } finally {
      setBusy(false);
    }
  };

  const showPreview = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewSchedulerWorkflow(definition));
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Unable to render workflow preview",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="scheduler-workflows">
      <div className="scheduler-section-title">
        <div>
          <span className="scheduler-eyebrow">Automations</span>
          <h1>Workflow automation</h1>
          <p>
            Publish versioned reminders, follow-ups, notifications, and delivery
            integrations.
          </p>
        </div>
        <div className="scheduler-workflow-actions">
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() =>
              setMode(mode === "builder" ? "operations" : "builder")
            }
          >
            <Activity size={16} /> Delivery operations
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => void createWorkflow()}
          >
            <Plus size={16} /> Create workflow
          </button>
        </div>
      </div>
      {error && <ErrorBanner error={error} />}
      {mode === "operations" ? (
        <div className="scheduler-operations">
          <div className="scheduler-operations-summary">
            <article>
              <BellRing size={18} />
              <div>
                <strong>
                  {alerts.filter((alert) => !alert.resolvedAt).length}
                </strong>
                <span>Open alerts</span>
              </div>
            </article>
            <article>
              <RefreshCw size={18} />
              <div>
                <strong>
                  {jobs.filter((job) => job.deadLetteredAt).length}
                </strong>
                <span>Needs recovery</span>
              </div>
            </article>
          </div>
          <div className="scheduler-section-title">
            <div>
              <h2>Delivery operations</h2>
              <p>
                Retry safe failures, acknowledge externally verified deliveries,
                or cancel retained payloads.
              </p>
            </div>
          </div>
          <section className="scheduler-notification-center">
            <div className="scheduler-section-title">
              <div>
                <h2>In-app notifications</h2>
                <p>
                  {notifications.filter((notification) => !notification.readAt)
                    .length} unread workflow notifications.
                </p>
              </div>
            </div>
            {notifications.length === 0 ? (
              <p className="scheduler-muted">No in-app notifications yet.</p>
            ) : (
              <div className="scheduler-notification-list">
                {notifications.map((notification) => (
                  <article
                    className={notification.readAt ? "read" : "unread"}
                    key={notification.id}
                  >
                    <div>
                      <strong>{notification.title}</strong>
                      <p>{notification.body}</p>
                    </div>
                    <div className="scheduler-notification-actions">
                      {!notification.readAt && (
                        <button
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() =>
                            void markNotificationRead(notification.id)
                          }
                        >
                          Mark read
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() =>
                          void dismissNotification(notification.id)
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          {jobs.length === 0 ? (
            <p className="scheduler-muted">No workflow deliveries yet.</p>
          ) : (
            <div className="scheduler-operation-list">
              {jobs.map((job) => (
                <article key={job.id}>
                  <div>
                    <strong>{job.workflowName}</strong>
                    <span>
                      {job.jobType.replaceAll(".", " ")} ·{" "}
                      {job.contactEmail || "internal"} · {job.attempts} attempt
                      {job.attempts === 1 ? "" : "s"}
                    </span>
                    {job.lastErrorCode && <code>{job.lastErrorCode}</code>}
                  </div>
                  <span
                    className={`booking-status ${job.deadLetteredAt ? "cancelled" : job.completedAt ? "confirmed" : "requested"}`}
                  >
                    {job.deadLetteredAt
                      ? "needs review"
                      : job.completedAt
                        ? "delivered"
                        : job.cancelledAt
                          ? "cancelled"
                          : "pending"}
                  </span>
                  {job.deadLetteredAt && (
                    <div className="scheduler-row-actions">
                      <button
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => void reconcile(job.id, "retry")}
                      >
                        Retry
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => void reconcile(job.id, "delivered")}
                      >
                        Mark delivered
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => void reconcile(job.id, "cancel")}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="scheduler-workflow-layout">
          <aside className="scheduler-workflow-list">
            <header>
              <strong>Workflows</strong>
              <span>
                {workflows.filter((workflow) => !workflow.archivedAt).length}
              </span>
            </header>
            {workflows
              .filter((workflow) => !workflow.archivedAt)
              .map((workflow) => (
                <button
                  type="button"
                  className={workflow.id === selectedId ? "active" : ""}
                  onClick={() => selectWorkflow(workflow)}
                  key={workflow.id}
                >
                  <Workflow size={17} />
                  <span>
                    <strong>{workflow.name}</strong>
                    <small>
                      {workflow.currentVersion
                        ? `Version ${workflow.currentVersion}`
                        : "Draft"}{" "}
                      · {workflow.enabled ? "On" : "Off"}
                    </small>
                  </span>
                </button>
              ))}
            {workflows.length === 0 && (
              <p>Create a workflow to automate the booking lifecycle.</p>
            )}
          </aside>
          <div className="scheduler-workflow-builder">
            <header>
              <div>
                <h2>{selected ? name : "Choose a workflow"}</h2>
                <p>
                  {selected
                    ? "Changes become immutable when you publish a new version."
                    : "Create or select a workflow to open the builder."}
                </p>
              </div>
              <div className="scheduler-row-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!selected || busy}
                  onClick={() => void cloneWorkflow()}
                >
                  <Copy size={15} /> Clone
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!selected || busy}
                  onClick={() => void sendTest()}
                >
                  <Send size={15} /> Test send
                </button>
              </div>
            </header>
            {selected && (
              <>
                <div className="scheduler-form-grid">
                  <label>
                    Workflow name
                    <input
                      value={name}
                      maxLength={160}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label>
                    Trigger
                    <select
                      value={definition.trigger.type}
                      onChange={(event) =>
                        setDefinition({
                          ...definition,
                          trigger: {
                            ...definition.trigger,
                            type: event.target
                              .value as SchedulerWorkflowTrigger,
                            offsetSeconds: [
                              "booking.start",
                              "booking.ended",
                            ].includes(event.target.value)
                              ? definition.trigger.offsetSeconds
                              : Math.max(0, definition.trigger.offsetSeconds),
                          },
                        })
                      }
                    >
                      {triggerOptions.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Offset in minutes
                    <input
                      type="number"
                      value={definition.trigger.offsetSeconds / 60}
                      onChange={(event) =>
                        setDefinition({
                          ...definition,
                          trigger: {
                            ...definition.trigger,
                            offsetSeconds: Math.trunc(
                              Number(event.target.value) * 60,
                            ),
                          },
                        })
                      }
                    />
                    <small>
                      {definition.trigger.offsetSeconds < 0
                        ? `${secondsLabel(definition.trigger.offsetSeconds)} before`
                        : `${secondsLabel(definition.trigger.offsetSeconds)} after`}{" "}
                      the trigger
                    </small>
                  </label>
                  <fieldset className="scheduler-workflow-events">
                    <legend>Event types</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={eventTypeIds.length === 0}
                        onChange={() => setEventTypeIds([])}
                      />{" "}
                      All event types
                    </label>
                    {events.map((event) => (
                      <label key={event.id}>
                        <input
                          type="checkbox"
                          checked={eventTypeIds.includes(event.id)}
                          onChange={(change) =>
                            setEventTypeIds((current) =>
                              change.target.checked
                                ? [...current, event.id]
                                : current.filter((id) => id !== event.id),
                            )
                          }
                        />{" "}
                        {event.title}
                      </label>
                    ))}
                  </fieldset>
                </div>
                <div className="scheduler-workflow-steps">
                  <div className="scheduler-section-title">
                    <div>
                      <h3>Actions</h3>
                      <p>Steps run in order after their individual delay.</p>
                    </div>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={definition.steps.length >= 20}
                      onClick={() =>
                        setDefinition({
                          ...definition,
                          steps: [
                            ...definition.steps,
                            {
                              action: "message.email",
                              delaySeconds: 0,
                              config: {
                                recipient: "guest",
                                subject: "{{event.title}}",
                                body: "Hello {{booker.name}}",
                              },
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={15} /> Add action
                    </button>
                  </div>
                  {providers.some(
                    (provider) => provider.channel === "translation",
                  ) && (
                    <div className="scheduler-translation-tools">
                      <Languages size={18} />
                      <label>
                        Translation provider
                        <select
                          value={translationProviderId}
                          onChange={(event) =>
                            setTranslationProviderId(event.target.value)
                          }
                        >
                          <option value="">Choose provider</option>
                          {providers
                            .filter(
                              (provider) => provider.channel === "translation",
                            )
                            .map((provider) => (
                              <option value={provider.id} key={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Target locales
                        <input
                          value={translationLocales}
                          onChange={(event) =>
                            setTranslationLocales(event.target.value)
                          }
                          placeholder="es, fr-FR"
                        />
                      </label>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void generateTranslations()}
                      >
                        Generate translations
                      </button>
                      <small>
                        Original templates stay intact; generated locale
                        versions are saved in the next immutable workflow
                        version.
                      </small>
                    </div>
                  )}
                  {definition.steps.map((step, index) => (
                    <article key={index}>
                      <span className="scheduler-step-number">{index + 1}</span>
                      <div className="scheduler-form-grid">
                        <label>
                          Action
                          <select
                            value={step.action}
                            onChange={(event) =>
                              updateStep(index, {
                                action: event.target
                                  .value as SchedulerWorkflowAction,
                                config:
                                  event.target.value === "notification.in_app"
                                    ? {
                                        recipient: "host",
                                        title: "{{event.title}}",
                                        body: "{{booker.name}}",
                                      }
                                    : event.target.value === "message.external"
                                      ? {
                                          providerId: "",
                                          channel: "sms",
                                          body: "{{event.title}}",
                                          requiresConsent: true,
                                        }
                                      : event.target.value === "webhook.http"
                                        ? { providerId: "" }
                                        : {
                                            recipient: "guest",
                                            subject: "{{event.title}}",
                                            body: "Hello {{booker.name}}",
                                          },
                              })
                            }
                          >
                            {actionOptions.map((option) => (
                              <option value={option.value} key={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Delay in minutes
                          <input
                            type="number"
                            min={0}
                            value={step.delaySeconds / 60}
                            onChange={(event) =>
                              updateStep(index, {
                                delaySeconds: Math.max(
                                  0,
                                  Math.trunc(Number(event.target.value) * 60),
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Run only when
                          <select
                            value={step.condition?.field || ""}
                            onChange={(event) =>
                              updateStep(index, {
                                condition: event.target.value
                                  ? {
                                      field: event.target.value as NonNullable<
                                        typeof step.condition
                                      >["field"],
                                      operator:
                                        event.target.value === "booking.consent"
                                          ? "contains"
                                          : "equals",
                                      value:
                                        event.target.value === "booking.status"
                                          ? "confirmed"
                                          : event.target.value ===
                                              "booking.consent"
                                            ? "sms"
                                            : "en",
                                    }
                                  : undefined,
                              })
                            }
                          >
                            <option value="">Always</option>
                            <option value="booking.status">
                              Booking status
                            </option>
                            <option value="booker.locale">Booker locale</option>
                            <option value="booking.consent">
                              Booking consent
                            </option>
                          </select>
                        </label>
                        {step.condition && (
                          <>
                            <label>
                              Condition
                              <select
                                value={step.condition.operator}
                                onChange={(event) =>
                                  updateStep(index, {
                                    condition: {
                                      ...step.condition!,
                                      operator: event.target
                                        .value as NonNullable<
                                        typeof step.condition
                                      >["operator"],
                                    },
                                  })
                                }
                              >
                                {step.condition.field === "booking.consent" ? (
                                  <option value="contains">Includes</option>
                                ) : (
                                  <>
                                    <option value="equals">Equals</option>
                                    <option value="not_equals">
                                      Does not equal
                                    </option>
                                    <option value="contains">Contains</option>
                                  </>
                                )}
                              </select>
                            </label>
                            <label>
                              Value
                              {step.condition.field === "booking.consent" ? (
                                <select
                                  value={step.condition.value}
                                  onChange={(event) =>
                                    updateStep(index, {
                                      condition: {
                                        ...step.condition!,
                                        value: event.target.value,
                                      },
                                    })
                                  }
                                >
                                  <option value="sms">SMS</option>
                                  <option value="whatsapp">WhatsApp</option>
                                  <option value="voice">Voice</option>
                                </select>
                              ) : (
                                <input
                                  value={step.condition.value}
                                  onChange={(event) =>
                                    updateStep(index, {
                                      condition: {
                                        ...step.condition!,
                                        value: event.target.value,
                                      },
                                    })
                                  }
                                />
                              )}
                            </label>
                          </>
                        )}
                        {(step.action === "webhook.http" ||
                          step.action === "message.external") && (
                          <label>
                            Delivery provider
                            <select
                              required
                              value={String(step.config.providerId || "")}
                              onChange={(event) =>
                                updateConfig(index, {
                                  providerId: event.target.value,
                                })
                              }
                            >
                              <option value="">Choose provider</option>
                              {providers
                                .filter((provider) =>
                                  step.action === "webhook.http"
                                    ? provider.channel === "webhook"
                                    : provider.channel ===
                                      String(step.config.channel || "sms"),
                                )
                                .map((provider) => (
                                  <option value={provider.id} key={provider.id}>
                                    {provider.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        {step.action === "message.external" && (
                          <label>
                            Channel
                            <select
                              value={String(step.config.channel || "sms")}
                              onChange={(event) =>
                                updateConfig(index, {
                                  channel: event.target.value,
                                  providerId: "",
                                })
                              }
                            >
                              <option value="sms">SMS</option>
                              <option value="whatsapp">WhatsApp</option>
                              <option value="voice">Voice</option>
                            </select>
                          </label>
                        )}
                        {step.action !== "webhook.http" && (
                          <>
                            <label className="span-2">
                              Subject or title
                              <input
                                value={String(
                                  step.config.subject ||
                                    step.config.title ||
                                    "",
                                )}
                                onChange={(event) =>
                                  updateConfig(
                                    index,
                                    step.action === "notification.in_app"
                                      ? { title: event.target.value }
                                      : { subject: event.target.value },
                                  )
                                }
                                placeholder="Reminder: {{event.title}}"
                              />
                            </label>
                            <label className="span-2">
                              Message
                              <textarea
                                rows={5}
                                value={String(step.config.body || "")}
                                onChange={(event) =>
                                  updateConfig(index, {
                                    body: event.target.value,
                                  })
                                }
                              />
                              <small>
                                Variables: {"{{event.title}}"},{" "}
                                {"{{booking.start}}"},{" "}
                                {"{{booking.manage_url}}"}, {"{{booker.name}}"},{" "}
                                {"{{host.email}}"}
                              </small>
                            </label>
                            <label className="span-2">
                              Translations (JSON)
                              <textarea
                                key={`${selected.id}-${index}-${JSON.stringify(step.config.translations || {})}`}
                                rows={4}
                                defaultValue={JSON.stringify(
                                  step.config.translations || {},
                                  null,
                                  2,
                                )}
                                placeholder={
                                  '{"es":{"subject":"Recordatorio: {{event.title}}","body":"Hola {{booker.name}}"}}'
                                }
                                onBlur={(event) => {
                                  try {
                                    const translations = JSON.parse(
                                      event.target.value || "{}",
                                    );
                                    updateConfig(index, { translations });
                                    setError("");
                                  } catch {
                                    setError(
                                      "Translations must be a JSON object keyed by locale, such as es or fr-FR.",
                                    );
                                  }
                                }}
                              />
                              <small>
                                Up to 10 locale keys. Each locale may override
                                subject and body.
                              </small>
                            </label>
                          </>
                        )}
                      </div>
                      {definition.steps.length > 1 && (
                        <button
                          className="icon-button danger"
                          type="button"
                          aria-label={`Remove action ${index + 1}`}
                          onClick={() =>
                            setDefinition({
                              ...definition,
                              steps: definition.steps.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            })
                          }
                        >
                          ×
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {preview.length > 0 && (
                  <section className="scheduler-workflow-preview">
                    <h3>Preview</h3>
                    {preview.map((item, index) => (
                      <article key={index}>
                        <strong>{item.subject || item.action}</strong>
                        <pre>{item.body}</pre>
                      </article>
                    ))}
                  </section>
                )}
                <footer>
                  <div>
                    <label className="scheduler-publish">
                      <input
                        type="checkbox"
                        checked={selected.enabled}
                        disabled={busy || selected.currentVersion === null}
                        onChange={(event) =>
                          void toggleWorkflow(event.target.checked)
                        }
                      />
                      <span>Workflow enabled</span>
                    </label>
                    {selected.currentVersion === null && (
                      <small className="scheduler-publish-hint">
                        Publish a version before enabling this workflow.
                      </small>
                    )}
                    <button
                      className="btn btn-ghost danger"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Archive this workflow? Existing booking versions remain available for audit.",
                          )
                        ) {
                          void archiveWorkflow();
                        }
                      }}
                    >
                      <Archive size={15} /> Archive
                    </button>
                  </div>
                  <div>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void showPreview()}
                    >
                      <Eye size={15} /> Preview
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={busy || !name.trim()}
                      onClick={() => void publish()}
                    >
                      {busy ? "Publishing…" : "Publish new version"}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
