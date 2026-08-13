import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { loadSessionToken, signIn } from "../lib/api";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    void loadSessionToken().then((token) => {
      setHasSession(Boolean(token));
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: "#F7F7F4", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: "#6E6E68", textAlign: "center" }}>Loading…</Text>
      </View>
    );
  }
  if (hasSession) return <Redirect href="/" />;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#F7F7F4", justifyContent: "center", padding: 24 }}>
      <Text style={{ color: "#1B1B1E", fontSize: 32, fontWeight: "500", textAlign: "center" }}>
        Sign in to Rakazo
      </Text>
      <Text style={{ color: "#6E6E68", marginTop: 8, textAlign: "center" }}>
        Same Better Auth session as the web app.
      </Text>
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor="#8C8C86"
        value={email}
        onChangeText={setEmail}
        style={{
          marginTop: 28,
          backgroundColor: "#F1F1ED",
          borderRadius: 13,
          padding: 16,
          color: "#1B1B1E",
        }}
      />
      <TextInput
        placeholder="Password"
        placeholderTextColor="#8C8C86"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{
          marginTop: 12,
          backgroundColor: "#F1F1ED",
          borderRadius: 13,
          padding: 16,
          color: "#1B1B1E",
        }}
      />
      {error ? <Text style={{ color: "#C94244", marginTop: 12 }}>{error}</Text> : null}
      <Pressable
        onPress={() => void submit()}
        disabled={pending}
        style={{
          marginTop: 16,
          backgroundColor: "#121215",
          borderRadius: 13,
          padding: 18,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#FBFBF9", fontSize: 17 }}>
          {pending ? "Working…" : "Continue with email"}
        </Text>
      </Pressable>
    </View>
  );
}
