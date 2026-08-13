import type {
  Bot,
  ComputerStatus,
  ProductEvent,
  Routine,
  ThreadMessage,
  ThreadSnapshot,
} from "@rakazo/contracts";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { authClient } from "../lib/auth";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";
import { PluginsOverlay } from "./PluginsOverlay";
import { WindowChrome } from "./WindowChrome";

type Panel = "computer" | "settings" | "routine" | null;

export function ShellPage() {
  const { botId } = useParams();
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [bots, setBots] = useState<Bot[]>([]);
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [booting, setBooting] = useState(false);
  const [files, setFiles] = useState<Array<{ path: string; kind: string; size: number }>>([]);
  const [memory, setMemory] = useState<string>("");
  const [routineDraft, setRoutineDraft] = useState({ name: "", prompt: "", cron: "0 9 * * 1" });
  const [screenUrl, setScreenUrl] = useState<string | null>(null);
  const [usage, setUsage] = useState<{
    inputTokens: number;
    outputTokens: number;
    runs: number;
  } | null>(null);
  const autoBooted = useRef<string | null>(null);

  const active = bots.find((b) => b.id === botId) ?? bots[0];

  async function refreshBots() {
    const list = await rpc.bots.list();
    setBots(list);
    if (list.length === 0) {
      navigate("/onboarding", { replace: true });
      return;
    }
    if (!botId && list[0]) navigate(`/app/${list[0].id}`, { replace: true });
  }

  async function refreshThread(id: string) {
    const snap = await rpc.threads.get({ botId: id });
    setSnapshot(snap);
    setComputer(snap.computer);
    const [r, mem, fileList] = await Promise.all([
      rpc.routines.list({ botId: id }),
      rpc.memory.list({ botId: id }),
      rpc.computer.files({ botId: id, path: "/" }).catch(() => []),
    ]);
    setRoutines(r);
    setMemory(mem.map((m) => m.content).join("\n\n"));
    setFiles(fileList);
    const screen = await rpc.computer.screenUrl({ botId: id }).catch(() => ({ url: null }));
    setScreenUrl(screen.url);
    return snap;
  }

  useEffect(() => {
    void refreshBots();
  }, []);

  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let fallback: number | undefined;
    void (async () => {
      const snap = await refreshThread(active.id).catch(() => null);
      if (abort.signal.aborted) return;
      try {
        const events = await rpc.threads.subscribe(
          { botId: active.id, cursor: snap?.cursor ?? -1 },
          { signal: abort.signal },
        );
        for await (const event of events) {
          if (abort.signal.aborted) break;
          applyThreadEvent(event, setSnapshot, setComputer);
          if (
            event.type === "thread.message.created" ||
            event.type === "run.completed" ||
            event.type === "computer.status" ||
            event.type === "computer.takeover.granted"
          ) {
            void refreshThread(active.id).catch(() => undefined);
          }
        }
      } catch {
        if (!abort.signal.aborted) {
          fallback = window.setInterval(
            () => void refreshThread(active.id).catch(() => undefined),
            2500,
          );
        }
      }
    })();
    return () => {
      abort.abort();
      if (fallback !== undefined) window.clearInterval(fallback);
    };
  }, [active?.id]);

  const filtered = useMemo(
    () => bots.filter((b) => `${b.name} ${b.preview}`.toLowerCase().includes(query.toLowerCase())),
    [bots, query],
  );

  async function send() {
    if (!active || !draft.trim()) return;
    const text = draft;
    setDraft("");
    await rpc.threads.send({ botId: active.id, text });
    await refreshThread(active.id);
  }

  async function createBot() {
    const bot = await rpc.bots.create({
      name: "New Bot",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    await refreshBots();
    navigate(`/app/${bot.id}`);
    setPanel("settings");
  }

  async function bootComputer({
    takeControl,
    overlay,
  }: {
    takeControl: boolean;
    overlay: boolean;
  }) {
    if (!active) return;
    const needsBoot = computer?.state !== "running" || !screenUrl;
    if (overlay && needsBoot) setBooting(true);
    try {
      if (needsBoot) await rpc.computer.boot({ botId: active.id });
      if (takeControl) await rpc.computer.takeover({ botId: active.id });
      await refreshThread(active.id);
    } finally {
      setBooting(false);
    }
  }

  useEffect(() => {
    if (panel !== "computer" || !active) return;
    if (computer?.state === "booting") return;
    if (computer?.state === "running" && screenUrl) return;
    if (autoBooted.current === active.id) return;
    autoBooted.current = active.id;
    void bootComputer({ takeControl: false, overlay: false });
  }, [panel, active?.id, computer?.state, screenUrl]);

  const embeddedScreenUrl = embeddableScreenUrl(screenUrl);

  const userName = session.data?.user.name ?? "You";
  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative flex h-full min-w-0 overflow-hidden bg-[#050506] text-[#DFDFE2]">
      <aside className="flex w-[316px] shrink-0 flex-col border-r border-[#171719] bg-[#0B0B0C]">
        <div className="app-drag flex items-center justify-between px-[18px] pb-3 pt-4">
          <WindowChrome />
          <button
            type="button"
            onClick={() => void createBot()}
            className="app-no-drag text-[21px] text-[#7A7A80] hover:text-[#C9C9CE]"
            title="New bot"
          >
            +
          </button>
        </div>
        <div className="mx-3.5 mb-3 flex items-center gap-2.5 rounded-xl border border-[#202023] bg-[#141416] px-3 py-2 text-[14px] text-[#6C6C70]">
          <span>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent outline-none"
          />
        </div>
        <div className="rk-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2.5">
          {filtered.map((bot) => (
            <button
              key={bot.id}
              type="button"
              onClick={() => navigate(`/app/${bot.id}`)}
              className="flex gap-3 rounded-xl px-2.5 py-[11px] text-left"
              style={{ background: active?.id === bot.id ? "#161618" : "transparent" }}
            >
              <BotAvatar color={bot.color} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-medium text-[#ECECEE]">{bot.name}</span>
                  <span className="shrink-0 text-[12.5px] text-[#6C6C70]">
                    {bot.status === "idle" ? "" : bot.status}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[13.5px] text-[#85858A]">
                  {bot.preview || bot.title}
                </div>
              </div>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPluginsOpen(true)}
          className="mx-3 mb-1 flex items-center gap-3 rounded-[11px] px-2.5 py-2 hover:bg-[#131315]"
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#17171A] text-[#9A9AA0]">
            ⌁
          </span>
          <span className="text-[14.5px] text-[#C9C9CE]">Plugins</span>
        </button>
        <div className="relative">
          {menuOpen ? (
            <div className="absolute bottom-14 left-3 right-3 rounded-2xl border border-[#2A2A2F] bg-[#1A1A1D] p-2 shadow-[0_22px_50px_rgba(0,0,0,.55)]">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 hover:bg-[#232327]"
                onClick={async () => {
                  setUsage(await rpc.usage.summary());
                }}
              >
                <span className="text-[#9A9AA0]">◔</span>
                <span className="flex-1 text-left text-[14.5px] text-[#ECECEE]">Weekly usage</span>
              </button>
              {usage ? (
                <p className="px-3 pb-2 text-[12.5px] text-[#85858A]">
                  {usage.runs} runs · {usage.inputTokens + usage.outputTokens} tokens
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void authClient.signOut().then(() => navigate("/"))}
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 hover:bg-[#232327]"
              >
                <span className="text-[#9A9AA0]">⇤</span>
                <span className="text-[14.5px] text-[#ECECEE]">Log out</span>
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-[11px] px-[18px] py-3.5"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#232326] text-[12px] text-[#A8A8AD]">
              {initials}
            </span>
            <span className="text-[14.5px] text-[#C9C9CE]">{userName}</span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[#0D0D0E]">
        <div className="flex items-center justify-between border-b border-[#141416] px-[22px] py-[17px]">
          <button
            type="button"
            onClick={() => setPanel("settings")}
            className="flex items-center gap-3"
          >
            {active ? <BotAvatar color={active.color} size={26} /> : null}
            <span className="text-[16px] font-medium text-[#ECECEE]">
              {active?.name ?? "Select a bot"}
            </span>
          </button>
          <button
            type="button"
            title="Agent computer"
            onClick={() => setPanel((p) => (p === "computer" ? null : "computer"))}
            className="grid h-[30px] w-[34px] place-items-center rounded-[9px] hover:bg-[#1B1B1E]"
            style={{ background: panel ? "#1B1B1E" : "transparent" }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#A8A8AD"
              strokeWidth="1.6"
            >
              <rect x="2" y="4" width="20" height="13" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </button>
        </div>
        <div className="rk-scroll flex flex-1 flex-col gap-[13px] overflow-y-auto px-7 py-6">
          {(snapshot?.messages ?? []).map((message) => (
            <MessageView
              key={message.id}
              message={message}
              onAnswer={(text) =>
                active &&
                rpc.threads.answer({ botId: active.id, runId: message.runId ?? "", answer: text })
              }
            />
          ))}
          {snapshot?.run && ["running", "queued", "leased"].includes(snapshot.run.status) ? (
            <div className="flex justify-start">
              <div
                className="rounded-[20px] bg-[#1A1A1D] px-[18px] py-[13px] text-[14.5px] text-[#85858A]"
                style={{ animation: "rkPulse 1.2s ease-in-out infinite" }}
              >
                working…
              </div>
            </div>
          ) : null}
        </div>
        <div className="px-6 pb-6 pt-3">
          <div className="flex items-center gap-3.5 rounded-full border border-[#202023] bg-[#131315] py-[9px] pr-2.5 pl-3">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border border-[#26262A] text-[18px] text-[#9A9AA0]">
              +
            </span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={active ? `Message ${active.name}` : "Message…"}
              className="flex-1 bg-transparent text-[15.5px] text-[#E9E9EA] outline-none"
            />
            {snapshot?.run && ["running", "queued", "leased"].includes(snapshot.run.status) ? (
              <button
                type="button"
                onClick={() => active && void rpc.threads.stop({ botId: active.id })}
                className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F1EF] text-[#17171A]"
              >
                ■
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F1EF] text-[#17171A]"
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </main>

      {panel && active ? (
        <aside className="rk-scroll absolute inset-y-0 right-0 z-20 w-[min(384px,100%)] overflow-y-auto border-l border-[#141416] bg-[#0A0A0B] px-5 py-[17px] shadow-[-24px_0_48px_rgba(0,0,0,.35)]">
          {panel !== "routine" ? (
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[13.5px] text-[#85858A]">
                {computer?.state ?? active.status}
              </span>
              <div className="flex gap-3.5">
                <button type="button" onClick={() => setPanel("settings")}>
                  ⚙
                </button>
                <button type="button" onClick={() => setPanel(null)}>
                  ✕
                </button>
              </div>
            </div>
          ) : null}
          {panel === "computer" ? (
            <div>
              <div className="relative aspect-[16/10] overflow-hidden rounded-[14px] bg-[#0E0E10]">
                {embeddedScreenUrl ? (
                  <iframe
                    title="Bot screen"
                    src={embeddedScreenUrl}
                    className="h-full w-full border-0 bg-black"
                    allow="clipboard-read; clipboard-write; fullscreen"
                    style={{ pointerEvents: computer?.controlHolder === "user" ? "auto" : "none" }}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-sm text-[#6C6C70]">
                    {computer?.state === "booting" || booting
                      ? "Booting live desktop…"
                      : computer?.state === "running"
                        ? `${active.name}’s screen`
                        : computer?.state === "error"
                          ? "Computer failed to boot"
                          : "Computer is stopped"}
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[13.5px] text-[#85858A]">
                  {computer?.controlHolder === "user"
                    ? "You have control"
                    : `${active.name}’s screen`}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void bootComputer({ takeControl: true, overlay: true })}
                >
                  Take control
                </Button>
              </div>
              <div className="mt-[30px] mb-3 text-[14px] text-[#85858A]">Routines</div>
              {routines.map((routine) => (
                <button
                  key={routine.id}
                  type="button"
                  onClick={() => {
                    setRoutineDraft({
                      name: routine.name,
                      prompt: routine.prompt,
                      cron: routine.cron,
                    });
                    setPanel("routine");
                  }}
                  className="flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2.5 hover:bg-[#121214]"
                >
                  <span className="text-[#E65707]">◷</span>
                  <span className="flex-1 text-left text-[14.5px] text-[#ECECEE]">
                    {routine.name}
                  </span>
                  <span className="text-[13px] text-[#6C6C70]">{routine.cron}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={async () => {
                  const first = routines[0];
                  if (first) {
                    await rpc.routines.testRun({ routineId: first.id });
                    await refreshThread(active.id);
                  } else {
                    setPanel("routine");
                  }
                }}
                className="mt-1 flex items-center gap-2.5 px-2.5 py-2.5 text-[14.5px] text-[#7A7A80]"
              >
                Run now
              </button>
              <button
                type="button"
                onClick={() => setPanel("routine")}
                className="mt-1 flex items-center gap-2.5 px-2.5 py-2.5 text-[14.5px] text-[#7A7A80]"
              >
                + New routine
              </button>
              <div className="mt-8 text-[14px] text-[#85858A]">Memory</div>
              <pre className="mt-2 whitespace-pre-wrap text-[13px] text-[#C9C9CE]">
                {memory || "No memory yet."}
              </pre>
              <div className="mt-8 text-[14px] text-[#85858A]">Files</div>
              <ul className="mt-2 text-[13px] text-[#C9C9CE]">
                {files
                  .filter(
                    (file) =>
                      !file.path
                        .split("/")
                        .filter(Boolean)
                        .some((part) => part.startsWith(".")),
                  )
                  .map((file) => (
                    <li key={file.path}>{file.path}</li>
                  ))}
              </ul>
            </div>
          ) : null}
          {panel === "settings" ? (
            <BotSettings
              bot={active}
              onSave={async (patch) => {
                await rpc.bots.update({ botId: active.id, ...patch });
                await refreshBots();
              }}
              onExport={async () => {
                const manifest = await rpc.export.bot({ botId: active.id });
                const blob = new Blob([JSON.stringify(manifest, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${active.name.toLowerCase().replace(/\s+/g, "-")}-export.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            />
          ) : null}
          {panel === "routine" ? (
            <div>
              <div className="mb-5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPanel("computer")}
                  className="text-[#9A9AA0]"
                >
                  ‹
                </button>
                <div className="text-[15.5px] font-medium text-[#F1F1F2]">Routine</div>
                <button type="button" onClick={() => setPanel(null)} className="text-[#6C6C70]">
                  ✕
                </button>
              </div>
              <label className="text-[14px] text-[#85858A]">
                Name
                <input
                  value={routineDraft.name}
                  onChange={(e) => setRoutineDraft((s) => ({ ...s, name: e.target.value }))}
                  className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
                />
              </label>
              <label className="mt-5 block text-[14px] text-[#85858A]">
                Instruction
                <textarea
                  value={routineDraft.prompt}
                  onChange={(e) => setRoutineDraft((s) => ({ ...s, prompt: e.target.value }))}
                  rows={4}
                  className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
                />
              </label>
              <label className="mt-5 block text-[14px] text-[#85858A]">
                Cron
                <input
                  value={routineDraft.cron}
                  onChange={(e) => setRoutineDraft((s) => ({ ...s, cron: e.target.value }))}
                  className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 font-mono text-[#ECECEE]"
                />
              </label>
              <Button
                type="button"
                variant="cream"
                className="mt-5"
                onClick={async () => {
                  await rpc.routines.create({
                    botId: active.id,
                    name: routineDraft.name || "Routine",
                    prompt: routineDraft.prompt || "Check in.",
                    cron: routineDraft.cron,
                    timezone: "UTC",
                    active: true,
                    notify: true,
                  });
                  await refreshThread(active.id);
                  setPanel("computer");
                }}
              >
                Save routine
              </Button>
            </div>
          ) : null}
        </aside>
      ) : null}

      {pluginsOpen ? <PluginsOverlay onClose={() => setPluginsOpen(false)} /> : null}

      {booting ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[22px] bg-[rgba(4,4,5,.88)]">
          <div className="text-[19px] font-medium text-[#F1F1F2]">
            Booting up {active?.name}’s computer
          </div>
          <div className="h-[5px] w-[420px] overflow-hidden rounded-full bg-[#232327]">
            <div className="h-full w-2/3 rounded-full bg-[#F1F1EF]" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function applyThreadEvent(
  event: ProductEvent,
  setSnapshot: Dispatch<SetStateAction<ThreadSnapshot | null>>,
  setComputer: Dispatch<SetStateAction<ComputerStatus | null>>,
) {
  if (event.type === "thread.progress") {
    const text = String(event.payload.text ?? "");
    setSnapshot((prev) => {
      if (!prev) return prev;
      const streaming: ThreadMessage = {
        id: `progress:${event.runId ?? event.id}`,
        threadId: event.threadId,
        seq: event.seq,
        role: "bot",
        blocks: [{ kind: "progress", text }],
        runId: event.runId,
        createdAt: event.createdAt,
      };
      const without = prev.messages.filter((message) => !message.id.startsWith("progress:"));
      return { ...prev, cursor: event.seq, messages: [...without, streaming] };
    });
    return;
  }
  if (event.type === "thread.message.created") {
    const role = (event.payload.role as ThreadMessage["role"]) ?? "bot";
    const blocks = (event.payload.blocks as ThreadMessage["blocks"]) ?? [];
    const next: ThreadMessage = {
      id: String(event.payload.messageId ?? event.id),
      threadId: event.threadId,
      seq: event.seq,
      role,
      blocks,
      runId: event.runId,
      createdAt: event.createdAt,
    };
    setSnapshot((prev) => {
      if (!prev) return prev;
      const without = prev.messages.filter(
        (message) => message.id !== next.id && !message.id.startsWith("progress:"),
      );
      return { ...prev, cursor: event.seq, messages: [...without, next] };
    });
  }
  if (event.type === "computer.status" || event.type === "computer.takeover.granted") {
    setComputer((prev) =>
      prev
        ? {
            ...prev,
            controlHolder: event.type === "computer.takeover.granted" ? "user" : prev.controlHolder,
          }
        : prev,
    );
  }
}

function MessageView({
  message,
  onAnswer,
}: {
  message: ThreadMessage;
  onAnswer: (text: string) => void;
}) {
  return (
    <>
      {message.blocks.map((block, i) => {
        if (block.kind === "meta") {
          return (
            <div
              key={i}
              className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-[#85858A]"
            >
              <span className="text-[#E65707]">◷</span>
              <span>{block.text}</span>
            </div>
          );
        }
        if (block.kind === "progress") {
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[74%] rounded-[20px] bg-[#1A1A1D] px-[18px] py-3 text-[15.5px] leading-[1.5] text-[#DFDFE2]">
                {block.text}
                <span className="ml-1 inline-block animate-pulse text-[#85858A]">▍</span>
              </div>
            </div>
          );
        }
        if (block.kind === "text" && message.role === "user") {
          return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[70%] rounded-[20px] bg-[#F1F1EF] px-[18px] py-3 text-[15.5px] leading-[1.45] text-[#1A1A1A]">
                {block.text}
              </div>
            </div>
          );
        }
        if (block.kind === "text") {
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[74%] rounded-[20px] bg-[#1A1A1D] px-[18px] py-3 text-[15.5px] leading-[1.5] text-[#DFDFE2]">
                {block.text}
              </div>
            </div>
          );
        }
        if (block.kind === "card") {
          return (
            <div key={i} className="flex justify-start">
              <div className="flex flex-col gap-2 rounded-[20px] bg-[#1A1A1D] px-5 py-4">
                {block.lines.map((line) => (
                  <div key={line.k} className="flex items-baseline gap-2.5 text-[15px]">
                    <span className="text-[#30A24B]">✓</span>
                    <span className="font-semibold text-white">{line.k}</span>
                    <span className="text-[#85858A]">→</span>
                    <span>{line.v}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        if (block.kind === "ask") {
          return (
            <div
              key={i}
              className="max-w-[74%] rounded-[20px] border border-[#242428] bg-[#141417] px-5 py-[17px]"
            >
              <div className="text-[15.5px] leading-[1.5] text-[#ECECEE]">{block.text}</div>
              {block.detail ? (
                <pre className="mt-3 rounded-xl bg-[#0E0E10] px-3.5 py-3 font-mono text-[12.5px] leading-[1.7] text-[#85858A]">
                  {block.detail}
                </pre>
              ) : null}
              <div className="mt-3.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => onAnswer("approved")}
                  className="rounded-[11px] bg-[#F1F1EF] px-[17px] py-2 text-[14.5px] font-medium text-[#17171A]"
                >
                  Send it
                </button>
                <button
                  type="button"
                  className="rounded-[11px] border border-[#26262A] px-[17px] py-2 text-[14.5px] text-[#C9C9CE]"
                >
                  Edit first
                </button>
              </div>
            </div>
          );
        }
        if (block.kind === "computer") {
          return (
            <div
              key={i}
              className="w-[340px] rounded-[18px] border border-[#232326] bg-[#17171A] px-[18px] py-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium text-[#ECECEE]">Computer</span>
                <span className="rounded-full bg-[rgba(48,162,75,.14)] px-[11px] py-1 text-[13px] text-[#4ECB71]">
                  {block.state}
                </span>
              </div>
              <p className="my-2.5 text-[14.5px] leading-[1.5] text-[#A8A8AD]">{block.text}</p>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

function BotSettings({
  bot,
  onSave,
  onExport,
}: {
  bot: Bot;
  onSave: (patch: {
    name?: string;
    title?: string;
    description?: string;
    instructions?: string;
  }) => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const [name, setName] = useState(bot.name);
  const [title, setTitle] = useState(bot.title);
  const [description, setDescription] = useState(bot.description);
  const desktop = desktopBridge();
  const [grants, setGrants] = useState<string[]>([]);

  useEffect(() => {
    if (!desktop) return;
    void desktop
      .listGrants()
      .then(setGrants)
      .catch(() => undefined);
  }, [desktop]);

  return (
    <div>
      <div className="flex justify-center">
        <BotAvatar color={bot.color} size={64} />
      </div>
      <label className="mt-6 block text-[14px] text-[#85858A]">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <button
        type="button"
        onClick={() => void onSave({ name, title, description, instructions: description })}
        className="mt-5 rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[#17171A]"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => void onExport()}
        className="mt-3 text-[14px] text-[#85858A]"
      >
        Export without secrets
      </button>
      {desktop ? (
        <div className="mt-8">
          <div className="text-[14px] text-[#85858A]">Local folders</div>
          <p className="mt-1 text-[13px] text-[#6C6C70]">
            The desktop executor can only read folders you grant here.
          </p>
          <ul className="mt-2 text-[13px] text-[#C9C9CE]">
            {grants.map((grant) => (
              <li key={grant}>{grant}</li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-3 rounded-[11px] border border-[#26262A] px-4 py-2 text-[14px] text-[#ECECEE]"
            onClick={async () => {
              const folder = await desktop.grantFolder();
              if (!folder) return;
              await rpc.computer.grantFolder({ folder });
              setGrants(await desktop.listGrants());
            }}
          >
            Grant folder
          </button>
        </div>
      ) : null}
    </div>
  );
}

function embeddableScreenUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.href);
    const page = new URL(window.location.href);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const pagePort = page.port || (page.protocol === "https:" ? "443" : "80");
    if (local && parsed.port && parsed.port !== pagePort) {
      return `${page.origin}/novnc/${parsed.port}${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
