import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function Layout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{ headerStyle: { backgroundColor: "#0B0B0C" }, headerTintColor: "#ECECEE" }}
      >
        <Stack.Screen name="index" options={{ title: "Rakazo" }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="thread" options={{ title: "Thread" }} />
        <Stack.Screen name="computer" options={{ title: "Computer" }} />
      </Stack>
    </ThemeProvider>
  );
}
