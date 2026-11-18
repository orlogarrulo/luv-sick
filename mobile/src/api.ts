export type Product = {
  sku: string;
  name: string;
  brand: string;
  format: string;
  description: string;
  photoFile: string;
  priceAoa: number;
  compareAtAoa: number | null;
  availability: "ok" | "low" | "out";
  stockLeft: number | null;
  favorite: boolean;
};

export type Category = { id: string; name: string; count: number };

export type CartLine = { sku: string; name: string; qty: number; priceAoa: number };

const KEY = "ct-api";

export async function readApiUrl(): Promise<string> {
  const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
  return (await AsyncStorage.getItem(KEY)) ?? "";
}

export async function saveApiUrl(url: string) {
  const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
  await AsyncStorage.setItem(KEY, url.replace(/\/$/, ""));
}

export function photoUrl(api: string, file: string) {
  if (!api || !file) return "";
  return `${api}/fotos/${file}`;
}

export async function call<T>(api: string, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${api}/api/mobile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const data = (await res.json()) as T;
  return data;
}
