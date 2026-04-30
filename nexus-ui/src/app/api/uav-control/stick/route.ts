import { NextRequest, NextResponse } from "next/server";
import type { MqttClient } from "mqtt";

/**
 * 无人机键盘手控 API（stick_control）
 * 对应 C++ mainwindow.cpp slot_onUavStartCtrl 中的 50ms 定时 MQTT 发送
 */

interface StickControlBody {
  airportSN: string;
  roll: number; // 1024±660 (A/D 左右平移)
  pitch: number; // 1024±660 (W/S 前后)
  throttle: number; // 1024±660/±550 (C/Z 升降)
  yaw: number; // 1024±440 (Q/E 旋转)
  seq: number; // 序列号 0-65535
}

interface StickControlResult {
  ok: boolean;
  airportSN: string;
  seq: number;
  detail?: string;
}

function getEnv(key: string): string | null {
  return process.env[key] || null;
}

let mqttClientCache: MqttClient | null = null;

async function getMqttClient(): Promise<MqttClient | null> {
  if (mqttClientCache?.connected) return mqttClientCache;

  const brokerUrl = getEnv("NEXUS_UAV_MQTT_BROKER_URL");
  if (!brokerUrl) return null;

  try {
    const mqtt = await import("mqtt");
    const client = mqtt.connect(brokerUrl, {
      protocolVersion: 4,
      reconnectPeriod: 4000,
      connectTimeout: 10000,
      clean: true,
      clientId: `nexus-stick-${Math.random().toString(16).slice(2, 10)}`,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.end(true);
        reject(new Error("mqtt_connect_timeout"));
      }, 10000);

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
  } catch (e) {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<StickControlResult>> {
  try {
    const body = (await req.json()) as StickControlBody;
    const { airportSN, roll, pitch, throttle, yaw, seq } = body;

    if (!airportSN) {
      return NextResponse.json({
        ok: false,
        airportSN: "",
        seq: 0,
        detail: "missing_airportSN",
      });
    }

    const client = await getMqttClient();
    if (!client) {
      return NextResponse.json({
        ok: false,
        airportSN,
        seq,
        detail: "mqtt_not_connected_or_missing_NEXUS_UAV_MQTT_BROKER_URL",
      });
    }

    const topic = `thing/product/${airportSN}/drc/down`;
    const payload = {
      method: "stick_control",
      data: {
        roll,
        pitch,
        throttle,
        yaw,
        seq,
      },
    };

    return new Promise((resolve) => {
      client.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
        if (err) {
          resolve(
            NextResponse.json({
              ok: false,
              airportSN,
              seq,
              detail: err.message,
            }),
          );
        } else {
          resolve(
            NextResponse.json({
              ok: true,
              airportSN,
              seq,
            }),
          );
        }
      });
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      airportSN: "",
      seq: 0,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
