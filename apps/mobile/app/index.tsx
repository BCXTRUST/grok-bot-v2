import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { rpc, type MobileBot } from "../lib/api";

export default function Home() {
  const [bots, setBots] = useState<MobileBot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void rpc<MobileBot[]>("bots/list")
      .then(setBots)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#050506", padding: 24 }}>
      <Text style={{ color: "#ECECEE", fontSize: 28, fontWeight: "500" }}>Bots</Text>
      <Text style={{ color: "#85858A", marginTop: 8 }}>Open a thread, then the computer.</Text>
      {error ? <Text style={{ color: "#85858A", marginTop: 16 }}>Sign in on web first. {error}</Text> : null}
      {bots.map((bot) => (
        <Link key={bot.id} href={{ pathname: "/thread", params: { botId: bot.id, name: bot.name } }} asChild>
          <Pressable style={{ marginTop: 24, backgroundColor: "#1A1A1D", padding: 16, borderRadius: 16 }}>
            <Text style={{ color: "#ECECEE", fontSize: 16 }}>{bot.name}</Text>
            <Text style={{ color: "#85858A", marginTop: 4 }}>{bot.preview || bot.title || "One continuous thread"}</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}
