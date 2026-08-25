import type { SiteLogin } from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import { BuiButton } from "../components/beautiful-ui/primitives";
import { rpc } from "../lib/rpc";

export function LoginVaultSection({ botId }: { botId: string }) {
  const [items, setItems] = useState<SiteLogin[]>([]);
  const [site, setSite] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [share, setShare] = useState<"workspace" | "creator">("workspace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listGeneration = useRef(0);

  async function refresh() {
    const generation = ++listGeneration.current;
    const list = await rpc.vault.list({ botId });
    if (generation !== listGeneration.current) return;
    setItems(list);
  }

  useEffect(() => {
    const generation = ++listGeneration.current;
    void rpc.vault
      .list({ botId })
      .then((list) => {
        if (generation !== listGeneration.current) return;
        setItems(list);
      })
      .catch(() => {
        if (generation !== listGeneration.current) return;
        setItems([]);
      });
    return () => {
      listGeneration.current += 1;
    };
  }, [botId]);

  async function saveLogin() {
    if (!site.trim() || !username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await rpc.vault.upsert({
        botId,
        site: site.trim(),
        username: username.trim(),
        password,
        share,
      });
      setSite("");
      setUsername("");
      setPassword("");
      setItems((current) => {
        const next = current.filter((item) => item.id !== created.id);
        return [...next, created].sort((a, b) => a.host.localeCompare(b.host));
      });
      try {
        await refresh();
      } catch {
        setError("Saved, but list refresh failed");
      }
    } catch {
      setError("Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function removeLogin(item: SiteLogin) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.vault.remove({ loginId: item.id });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      try {
        await refresh();
      } catch {
        setError("Removed, but list refresh failed");
      }
    } catch {
      setError("Could not remove");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6" data-testid="bot-login-vault">
      <div className="mb-3 text-[14px] text-[#85858A]">Logins</div>
      {items.length === 0 ? (
        <div className="px-2.5 py-1 text-[13.5px] text-[#6C6C70]">None yet</div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className="flex w-full items-start gap-2 rounded-[11px] px-2.5 py-2.5 hover:bg-[#121214]"
          >
            <div className="min-w-0 flex-1">
              <div className="text-start text-[14.5px] text-[#ECECEE]">{item.host}</div>
              <div className="mt-0.5 text-[12.5px] text-[#6C6C70]">{item.username}</div>
            </div>
            <span className="shrink-0 text-[12px] text-[#6C6C70]">
              {item.share === "workspace" ? "All bots" : "This bot"}
            </span>
            <button
              type="button"
              aria-label={`Remove login for ${item.host}`}
              disabled={busy}
              onClick={() => void removeLogin(item)}
              className="shrink-0 text-[12px] text-[#7A7A80]"
            >
              ✕
            </button>
          </div>
        ))
      )}
      <form
        className="mt-2 flex flex-col gap-2 px-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          void saveLogin();
        }}
      >
        <input
          value={site}
          onChange={(event) => setSite(event.target.value)}
          placeholder="Site"
          aria-label="Site hostname or URL"
          autoComplete="off"
          className="min-w-0 rounded-[11px] border border-[#26262A] bg-transparent px-3 py-2 text-[14px] text-[#ECECEE] placeholder:text-[#55555A]"
        />
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          aria-label="Username"
          autoComplete="username"
          maxLength={200}
          className="min-w-0 rounded-[11px] border border-[#26262A] bg-transparent px-3 py-2 text-[14px] text-[#ECECEE] placeholder:text-[#55555A]"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          aria-label="Password"
          autoComplete="new-password"
          maxLength={500}
          className="min-w-0 rounded-[11px] border border-[#26262A] bg-transparent px-3 py-2 text-[14px] text-[#ECECEE] placeholder:text-[#55555A]"
        />
        <div className="flex gap-2">
          {(
            [
              { value: "workspace" as const, label: "All bots" },
              { value: "creator" as const, label: "This bot" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={share === option.value}
              aria-label={option.label}
              onClick={() => setShare(option.value)}
              className={`flex-1 rounded-[11px] border px-3 py-2 text-[13px] ${
                share === option.value
                  ? "border-[#4A4A50] bg-[#1A1A1D] text-[#ECECEE]"
                  : "border-[#26262A] text-[#85858A]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <BuiButton
          disabled={busy || !site.trim() || !username.trim() || !password}
          onClick={() => void saveLogin()}
        >
          Save
        </BuiButton>
      </form>
      {error ? <div className="mt-2 px-2.5 text-[13px] text-[#C45C5C]">{error}</div> : null}
    </div>
  );
}
