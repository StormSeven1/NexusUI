import { getUavMqttClient, isUavMqttClientConnected, publishUavDrcDown } from "@/lib/uav-control/uavMqttPublish.server";

/** 与 C++ / 前端键盘 hook 一致的 8 键状态 */
export type UavStickKeys = {
  Q: boolean;
  W: boolean;
  E: boolean;
  A: boolean;
  S: boolean;
  D: boolean;
  Z: boolean;
  C: boolean;
};

const KEY_VALUES = { Q: 440, W: 660, E: 440, A: 660, S: 660, D: 660, Z: 550, C: 660 } as const;
const STICK_NEUTRAL = 1024;
const STICK_TICK_MS = 50;

function anyKey(keys: UavStickKeys): boolean {
  return Object.values(keys).some(Boolean);
}

function computeStick(keys: UavStickKeys) {
  return {
    roll: STICK_NEUTRAL + (keys.D ? KEY_VALUES.D : 0) - (keys.A ? KEY_VALUES.A : 0),
    pitch: STICK_NEUTRAL + (keys.W ? KEY_VALUES.W : 0) - (keys.S ? KEY_VALUES.S : 0),
    throttle: STICK_NEUTRAL + (keys.C ? KEY_VALUES.C : 0) - (keys.Z ? KEY_VALUES.Z : 0),
    yaw: STICK_NEUTRAL + (keys.E ? KEY_VALUES.E : 0) - (keys.Q ? KEY_VALUES.Q : 0),
  };
}

type StickSession = {
  airportSN: string;
  keys: UavStickKeys;
  seq: number;
  timer: ReturnType<typeof setInterval> | null;
  tickCount: number;
  publishOk: number;
  publishFail: number;
  lastStickAt: number | null;
  lastError: string | null;
};

type HeartbeatSession = {
  airportSN: string;
  seq: number;
  timer: ReturnType<typeof setInterval> | null;
  tickCount: number;
  publishOk: number;
  publishFail: number;
  lastBeatAt: number | null;
};

const stickSessions = new Map<string, StickSession>();
const heartBeatSessions = new Map<string, HeartbeatSession>();

const EMPTY_KEYS: UavStickKeys = { Q: false, W: false, E: false, A: false, S: false, D: false, Z: false, C: false };

async function tickStick(session: StickSession) {
  if (!anyKey(session.keys)) return;
  const client = await getUavMqttClient();
  if (!client) {
    session.publishFail += 1;
    session.lastError = "mqtt_not_connected";
    return;
  }
  const { roll, pitch, throttle, yaw } = computeStick(session.keys);
  const ok = await publishUavDrcDown(client, session.airportSN, "stick_control", {
    roll,
    pitch,
    throttle,
    yaw,
    seq: session.seq,
  });
  session.tickCount += 1;
  session.lastStickAt = Date.now();
  if (ok) {
    session.publishOk += 1;
    session.seq = (session.seq + 1) % 65536;
    session.lastError = null;
  } else {
    session.publishFail += 1;
    session.lastError = "stick_publish_failed";
  }
}

function ensureStickTimer(session: StickSession) {
  if (session.timer) return;
  session.timer = setInterval(() => {
    void tickStick(session);
  }, STICK_TICK_MS);
}

function stopStickTimer(session: StickSession) {
  if (session.timer) {
    clearInterval(session.timer);
    session.timer = null;
  }
  session.seq = 0;
}

export function updateStickKeys(airportSN: string, keys: UavStickKeys): StickSession {
  const sn = airportSN.trim();
  let session = stickSessions.get(sn);
  if (!session) {
    session = {
      airportSN: sn,
      keys: { ...EMPTY_KEYS },
      seq: 0,
      timer: null,
      tickCount: 0,
      publishOk: 0,
      publishFail: 0,
      lastStickAt: null,
      lastError: null,
    };
    stickSessions.set(sn, session);
  }
  session.keys = { ...keys };
  if (anyKey(session.keys)) {
    ensureStickTimer(session);
    void tickStick(session);
  } else {
    stopStickTimer(session);
  }
  return session;
}

export function stopStickSession(airportSN: string) {
  const sn = airportSN.trim();
  const session = stickSessions.get(sn);
  if (!session) return;
  stopStickTimer(session);
  session.keys = { ...EMPTY_KEYS };
}

async function tickHeartBeat(session: HeartbeatSession) {
  const client = await getUavMqttClient();
  if (!client) {
    session.publishFail += 1;
    return;
  }
  const ok = await publishUavDrcDown(client, session.airportSN, "heart_beat", {
    seq: session.seq,
    timestamp: Math.floor(Date.now() / 1000),
  });
  session.tickCount += 1;
  session.lastBeatAt = Date.now();
  if (ok) {
    session.publishOk += 1;
    session.seq = (session.seq + 1) % 65536;
  } else {
    session.publishFail += 1;
  }
}

export function startHeartBeatSession(airportSN: string) {
  const sn = airportSN.trim();
  let session = heartBeatSessions.get(sn);
  if (session?.timer) return session;
  session = {
    airportSN: sn,
    seq: 0,
    timer: null,
    tickCount: 0,
    publishOk: 0,
    publishFail: 0,
    lastBeatAt: null,
  };
  heartBeatSessions.set(sn, session);
  void tickHeartBeat(session);
  session.timer = setInterval(() => {
    void tickHeartBeat(session!);
  }, 1000);
  return session;
}

export function stopHeartBeatSession(airportSN: string) {
  const sn = airportSN.trim();
  const session = heartBeatSessions.get(sn);
  if (!session) return;
  if (session.timer) {
    clearInterval(session.timer);
    session.timer = null;
  }
  heartBeatSessions.delete(sn);
  stopStickSession(sn);
}

export function getDrcSessionStatus(airportSN: string) {
  const sn = airportSN.trim();
  const stick = stickSessions.get(sn);
  const hb = heartBeatSessions.get(sn);
  return {
    mqttConnected: isUavMqttClientConnected(),
    brokerUrl: process.env.NEXUS_UAV_MQTT_BROKER_URL?.trim() || null,
    stickActive: Boolean(stick?.timer),
    stickTickCount: stick?.tickCount ?? 0,
    stickPublishOk: stick?.publishOk ?? 0,
    stickPublishFail: stick?.publishFail ?? 0,
    lastStickAt: stick?.lastStickAt ?? null,
    stickLastError: stick?.lastError ?? null,
    heartBeatActive: Boolean(hb?.timer),
    heartBeatTickCount: hb?.tickCount ?? 0,
    heartBeatPublishOk: hb?.publishOk ?? 0,
    heartBeatPublishFail: hb?.publishFail ?? 0,
    lastHeartBeatAt: hb?.lastBeatAt ?? null,
  };
}
