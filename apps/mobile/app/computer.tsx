import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { rpc } from "../lib/api";

type Computer = { state: string; controlHolder: string; screenAvailable: boolean };

export default function Computer() {
  const { botId, name } = useLocalSearchParams<{ botId?: string; name?: string }>();
  const [computer, setComputer] = useState<Computer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!botId) return;
    setComputer(await rpc<Computer>("computer/status", { botId }));
  }

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message));
  }, [botId]);

  async function takeover() {
    if (!botId) return;
    await rpc("computer/boot", { botId }).catch(() => undefined);
    await rpc("computer/takeover", { botId });
    await refresh();
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0A0A0B", padding: 24 }}>
      <Text style={{ color: "#ECECEE", fontSize: 20 }}>{name ? `${name}’s computer` : "Computer"}</Text>
      {error ? <Text style={{ color: "#85858A", marginTop: 12 }}>{error}</Text> : null}
      <View style={{ marginTop: 16, height: 220, borderRadius: 14, backgroundColor: "#0E0E10", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#6C6C70" }}>
          {computer?.screenAvailable ? "Live screen" : computer?.state ?? "Computer is stopped"}
        </Text>
      </View>
      <Text style={{ color: "#85858A", marginTop: 16 }}>
        Control: {computer?.controlHolder ?? "none"}. Takeover is exclusive to one device at a time.
      </Text>
      <Pressable
        onPress={() => void takeover()}
        style={{ marginTop: 20, backgroundColor: "#1A1A1D", padding: 14, borderRadius: 12, alignItems: "center" }}
      >
        <Text style={{ color: "#ECECEE" }}>Take control</Text>
      </Pressable>
    </View>
  );
}
