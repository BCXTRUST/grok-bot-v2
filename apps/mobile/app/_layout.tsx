import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { loadApiBase } from "../lib/api";

export default function Layout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadApiBase().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: "#0B0B0C" }} />;
  }

  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{ headerStyle: { backgroundColor: "#0B0B0C" }, headerTintColor: "#ECECEE" }}
      >
        <Stack.Screen name="index" options={{ title: "Rakazo" }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="new" options={{ title: "New bot" }} />
        <Stack.Screen name="thread" options={{ title: "Thread" }} />
        <Stack.Screen name="computer" options={{ title: "Computer" }} />
      </Stack>
    </ThemeProvider>
  );
}
