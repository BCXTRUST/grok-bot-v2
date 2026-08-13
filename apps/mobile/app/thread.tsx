import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { blockText, rpc, type MobileSnapshot } from "../lib/api";

export default function Thread() {
  const { botId, name } = useLocalSearchParams<{ botId?: string; name?: string }>();
  const scroll = useRef<ScrollView>(null);
  const [snap, setSnap] = useState<MobileSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!botId) return;
    const next = await rpc<MobileSnapshot>("threads/get", { botId });
    setSnap(next);
  }

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message));
    const timer = setInterval(() => void refresh().catch(() => undefined), 1200);
    return () => clearInterval(timer);
  }, [botId]);

  async function send() {
    if (!botId || !draft.trim()) return;
    const text = draft;
    setDraft("");
    await rpc("threads/send", { botId, text });
    await refresh();
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0D0D0E", padding: 24 }}>
      <Text style={{ color: "#ECECEE", fontSize: 20 }}>{name || "Thread"}</Text>
      {error ? <Text style={{ color: "#85858A", marginTop: 12 }}>{error}</Text> : null}
      <ScrollView
        ref={scroll}
        style={{ flex: 1, marginTop: 16 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        {(snap?.messages ?? []).map((message) => (
          <View
            key={message.id}
            style={{
              marginTop: 12,
              alignSelf: message.role === "user" ? "flex-end" : "flex-start",
              backgroundColor: message.role === "user" ? "#F1F1EF" : "#1A1A1D",
              padding: 12,
              borderRadius: 20,
              maxWidth: "85%",
            }}
          >
            <Text style={{ color: message.role === "user" ? "#1A1A1A" : "#DFDFE2" }}>{blockText(message)}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message…"
          placeholderTextColor="#6C6C70"
          style={{ flex: 1, color: "#ECECEE", backgroundColor: "#131315", borderRadius: 20, paddingHorizontal: 14, height: 44 }}
        />
        <Pressable onPress={() => void send()} style={{ backgroundColor: "#F1F1EF", borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Text>↑</Text>
        </Pressable>
      </View>
      <Link href={{ pathname: "/computer", params: { botId: botId ?? "", name: name ?? "Bot" } }} asChild>
        <Pressable style={{ marginTop: 16 }}>
          <Text style={{ color: "#C9C9CE" }}>Open computer →</Text>
        </Pressable>
      </Link>
    </View>
  );
}
