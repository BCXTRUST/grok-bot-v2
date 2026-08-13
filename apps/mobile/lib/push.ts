import * as Notifications from "expo-notifications";
import { rpc } from "./api";

export async function registerPushToken() {
  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  if (!token) return;
  await rpc("notifications/registerPush", { token });
}
