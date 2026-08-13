import { Link, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { loadSessionToken, type MobileBot, rpc, signOut } from "../lib/api";
import { registerPushToken } from "../lib/push";

export default function Home() {
  const [bots, setBots] = useState<MobileBot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    void loadSessionToken().then((token) => {
      setHasSession(Boolean(token));
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    void registerPushToken().catch(() => undefined);
    void rpc<MobileBot[]>("bots/list")
      .then(setBots)
      .catch((err: Error) => setError(err.message));
  }, [hasSession]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: "#050506", padding: 24, justifyContent: "center" }}>
        <Text style={{ color: "#85858A" }}>Loading…</Text>
      </View>
    );
  }
  if (!hasSession) return <Redirect href="/sign-in" />;

  return (
    <View style={{ flex: 1, backgroundColor: "#050506", padding: 24 }}>
      <Text style={{ color: "#ECECEE", fontSize: 28, fontWeight: "500" }}>Bots</Text>
      <Text style={{ color: "#85858A", marginTop: 8 }}>Open a thread, then the computer.</Text>
      {error ? <Text style={{ color: "#85858A", marginTop: 16 }}>{error}</Text> : null}
      {bots.map((bot) => (
        <Link
          key={bot.id}
          href={{ pathname: "/thread", params: { botId: bot.id, name: bot.name } }}
          asChild
        >
          <Pressable
            style={{ marginTop: 24, backgroundColor: "#1A1A1D", padding: 16, borderRadius: 16 }}
          >
            <Text style={{ color: "#ECECEE", fontSize: 16 }}>{bot.name}</Text>
            <Text style={{ color: "#85858A", marginTop: 4 }}>
              {bot.preview || bot.title || "One continuous thread"}
            </Text>
          </Pressable>
        </Link>
      ))}
      <Pressable
        onPress={() => void signOut().then(() => setHasSession(false))}
        style={{ marginTop: 32 }}
      >
        <Text style={{ color: "#85858A" }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
