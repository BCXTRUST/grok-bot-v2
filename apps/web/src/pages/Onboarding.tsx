import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpc } from "../lib/rpc";

const QUESTIONS = [
  {
    q: "What do you mainly want help with?",
    sub: "Pick whatever’s closest, or type your own.",
    opts: ["Inbox & email", "Slack & messages", "Coding & repos", "Research & writing", "A bit of everything"],
  },
  {
    q: "How do you want me to write?",
    sub: "I’ll match this unless you say otherwise.",
    opts: ["Clear and tight", "Warm and conversational", "Polished / formal", "Match whatever I draft"],
  },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"loading" | "model" | "bot" | "questions">("loading");
  const [provider, setProvider] = useState("openrouter");
  const [modelId, setModelId] = useState("deepseek/deepseek-v4-flash-0731");
  const [apiKey, setApiKey] = useState("");
  const [name, setName] = useState("Chief");
  const [title, setTitle] = useState("Chief of staff");
  const [description, setDescription] = useState("Keeps work moving and comes back with results.");
  const [answers, setAnswers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("me timeout")), 2500);
    });
    void Promise.race([rpc.me(), timeout])
      .then((me) => setStep(me.needsModel ? "model" : "bot"))
      .catch(() => setStep("bot"));
  }, []);

  async function saveModel() {
    setError(null);
    try {
      if (apiKey) {
        await rpc.models.connect({ provider, apiKey, modelId, label: provider });
      }
      await rpc.models.setDefault({ provider, modelId });
      setStep("bot");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save model");
    }
  }

  async function createBot() {
    const instructions = answers.length
      ? `User setup:\n${answers.map((a) => `- ${a}`).join("\n")}`
      : description;
    const bot = await rpc.bots.create({ name, title, description, instructions, notifyOnFinish: true });
    navigate(`/app/${bot.id}`);
  }

  const question = QUESTIONS[answers.length];

  return (
    <div className="flex min-h-full items-center justify-center bg-[#0D0D0E] px-6">
      <div className="w-[560px]">
        {step === "loading" ? <p className="text-[#85858A]">Loading…</p> : null}
        {step === "model" ? (
          <div>
            <h1 className="text-[32px] font-medium text-[#F1F1F2]">Connect a model</h1>
            <p className="mt-2 text-[#85858A]">
              Rakazo does not pay for model usage. Bring an OpenRouter key, or skip if this deployment already has one.
            </p>
            <label className="mt-8 block text-sm text-[#85858A]">
              Provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
              >
                <option value="openrouter">OpenRouter</option>
                <option value="scripted">Scripted (local tests)</option>
              </select>
            </label>
            <label className="mt-4 block text-sm text-[#85858A]">
              Model
              <input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
              />
            </label>
            <label className="mt-4 block text-sm text-[#85858A]">
              API key
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-…"
                type="password"
                className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
              />
            </label>
            {error ? <p className="mt-3 text-sm text-[#E65707]">{error}</p> : null}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => void saveModel()}
                className="rounded-[11px] bg-[#F1F1EF] px-5 py-2.5 text-[#17171A]"
              >
                Continue
              </button>
              <button type="button" onClick={() => setStep("bot")} className="text-[#85858A]">
                Skip for now
              </button>
            </div>
          </div>
        ) : null}
        {step === "bot" ? (
          <div>
            <h1 className="text-[32px] font-medium text-[#F1F1F2]">Create your first bot</h1>
            <label className="mt-8 block text-sm text-[#85858A]">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
              />
            </label>
            <label className="mt-4 block text-sm text-[#85858A]">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
              />
            </label>
            <label className="mt-4 block text-sm text-[#85858A]">
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
              onClick={() => setStep("questions")}
              className="mt-6 rounded-[11px] bg-[#F1F1EF] px-5 py-2.5 text-[#17171A]"
            >
              Continue
            </button>
          </div>
        ) : null}
        {step === "questions" && question ? (
          <div className="rounded-[20px] bg-[#1A1A1D] p-5">
            <div className="text-[17px] font-medium text-[#F1F1F2]">{question.q}</div>
            <div className="mt-1 text-[15px] text-[#85858A]">{question.sub}</div>
            <div className="mt-3.5 overflow-hidden rounded-[13px] border border-[#232326]">
              {question.opts.map((opt, i) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setAnswers((a) => [...a, opt])}
                  className="flex w-full items-center gap-3.5 border-b border-[#202023] px-4 py-3.5 text-left last:border-0 hover:bg-[#222226]"
                >
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-[6px] bg-[#232327] text-[12.5px] text-[#9A9AA0]">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="text-[15.5px] text-[#ECECEE]">{opt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {step === "questions" && !question ? (
          <div>
            <h1 className="text-[32px] font-medium text-[#F1F1F2]">You’re set.</h1>
            <p className="mt-2 text-[#85858A]">I’ll pick up work the moment you send it.</p>
            <button
              type="button"
              onClick={() => void createBot()}
              className="mt-6 rounded-[11px] bg-[#F1F1EF] px-5 py-2.5 text-[#17171A]"
            >
              Open Rakazo
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
