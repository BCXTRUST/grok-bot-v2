import { Link, Redirect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { loadSessionToken, type MobileBot, rpc, signOut } from "../lib/api";
import { previewSnippet } from "../lib/preview";
import { registerPushToken } from "../lib/push";

export default function Home() {
  const [bots, setBots] = useState<MobileBot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadBots = useCallback(async () => {
    setError(null);
    try {
      setBots(await rpc<MobileBot[]>("bots/list"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bots");
    }
  }, []);

  const refreshBots = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadBots();
    } finally {
      setRefreshing(false);
    }
  }, [loadBots]);

  useEffect(() => {
    void loadSessionToken().then((token) => {
      setHasSession(Boolean(token));
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    void registerPushToken().catch(() => undefined);
    void loadBots();
  }, [hasSession, loadBots]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: "#050506", padding: 24, justifyContent: "center" }}>
        <Text style={{ color: "#85858A" }}>Loading…</Text>
      </View>
    );
  }
  if (!hasSession) return <Redirect href="/sign-in" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#050506" }}
      contentContainerStyle={{ flexGrow: 1, padding: 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refreshBots()}
          tintColor="#85858A"
          colors={["#85858A"]}
          progressBackgroundColor="#1A1A1D"
        />
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: "#ECECEE", fontSize: 28, fontWeight: "500" }}>Bots</Text>
        <Link href="/new" asChild>
          <Pressable>
            <Text style={{ color: "#7A7A80", fontSize: 28 }}>+</Text>
          </Pressable>
        </Link>
      </View>
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
            <Text style={{ color: "#85858A", marginTop: 4 }} numberOfLines={1}>
              {previewSnippet(bot.preview) || bot.title || "One continuous thread"}
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
    </ScrollView>
  );
}
