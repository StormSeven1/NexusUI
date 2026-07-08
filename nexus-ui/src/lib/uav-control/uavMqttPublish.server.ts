import type { MqttClient } from "mqtt";

let mqttClientCache: MqttClient | null = null;

export async function getUavMqttClient(): Promise<MqttClient | null> {
  if (mqttClientCache?.connected) return mqttClientCache;

  const brokerUrl = process.env.NEXUS_UAV_MQTT_BROKER_URL?.trim();
  if (!brokerUrl) return null;

  try {
    const mqtt = await import("mqtt");
    const client = mqtt.connect(brokerUrl, {
      protocolVersion: 4,
      reconnectPeriod: 4000,
      connectTimeout: 10_000,
      clean: true,
      clientId: `nexus-uav-drc-${Math.random().toString(16).slice(2, 10)}`,
    });

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.end(true);
        reject(new Error("mqtt_connect_timeout"));
      }, 10_000);

      client.on("connect", () => {
        clearTimeout(timer);
        mqttClientCache = client;
        resolve(client);
      });

      client.on("error", (err) => {
        clearTimeout(timer);
        client.end(true);
        reject(err);
      });
    });
  } catch {
    return null;
  }
}

export function publishUavDrcDown(
  client: MqttClient,
  airportSN: string,
  method: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const sn = airportSN.trim();
  if (!sn) return Promise.resolve(false);
  const topic = `thing/product/${sn}/drc/down`;
  const payload = JSON.stringify({ method, data });
  return new Promise((resolve) => {
    client.publish(topic, payload, { qos: 0 }, (err) => {
      resolve(!err);
    });
  });
}

export function isUavMqttClientConnected(): boolean {
  return Boolean(mqttClientCache?.connected);
}
