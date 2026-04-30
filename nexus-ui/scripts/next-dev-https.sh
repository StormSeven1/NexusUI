#!/usr/bin/env bash
# Next dev：HTTPS + 自定义证书（SAN 含 localhost / 127.0.0.1 / FRONTEND_HTTPS_SAN_IP）
# 避免用局域网 IP 访问时 Next 默认自签证书不覆盖该 IP，导致 Chrome 报 chrome-error://chromewebdata/
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

run_next() {
  exec next dev "$@"
}

if [[ -n "${NEXUS_DEV_HTTPS_KEY:-}" && -n "${NEXUS_DEV_HTTPS_CERT:-}" && -f "${NEXUS_DEV_HTTPS_KEY}" && -f "${NEXUS_DEV_HTTPS_CERT}" ]]; then
  run_next --experimental-https --experimental-https-key "${NEXUS_DEV_HTTPS_KEY}" --experimental-https-cert "${NEXUS_DEV_HTTPS_CERT}" -H 0.0.0.0
fi

CERT_DIR="${NEXUS_DEV_HTTPS_CERT_DIR:-.certs}"
KEY="${CERT_DIR}/dev.key"
CRT="${CERT_DIR}/dev.crt"
STAMP="${CERT_DIR}/san_stamp"
SAN_RAW="${FRONTEND_HTTPS_SAN_IP:-}"
SAN_NORM="$(echo "${SAN_RAW}" | tr ',' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
needs_gen=0
if [[ ! -f "${KEY}" || ! -f "${CRT}" ]]; then
  needs_gen=1
elif [[ ! -f "${STAMP}" ]] || [[ "$(cat "${STAMP}" 2>/dev/null || true)" != "${SAN_NORM}" ]]; then
  needs_gen=1
fi

if [[ "${needs_gen}" -eq 1 ]]; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "nexus-ui: 未找到 openssl，无法生成含局域网 IP 的证书；回退为 Next 默认 HTTPS（用 IP 访问可能仍被 Chrome 拦截）。" >&2
    run_next --experimental-https -H 0.0.0.0
  fi
  mkdir -p "${CERT_DIR}"
  CNF="${CERT_DIR}/openssl.cnf"
  {
    echo '[req]'
    echo 'distinguished_name = req_distinguished_name'
    echo 'x509_extensions = v3_req'
    echo 'prompt = no'
    echo '[req_distinguished_name]'
    echo 'CN = localhost'
    echo '[v3_req]'
    echo 'basicConstraints = CA:FALSE'
    echo 'keyUsage = digitalSignature, keyEncipherment'
    echo 'extendedKeyUsage = serverAuth'
    echo 'subjectAltName = @alt_names'
    echo '[alt_names]'
    echo 'DNS.1 = localhost'
    echo 'IP.1 = 127.0.0.1'
    i=2
    for ip in ${SAN_NORM}; do
      [[ -z "${ip}" ]] && continue
      echo "IP.${i} = ${ip}"
      i=$((i + 1))
    done
  } > "${CNF}"
  openssl req -x509 -nodes -newkey rsa:2048 -keyout "${KEY}" -out "${CRT}" -days 825 -config "${CNF}" -extensions v3_req
  printf '%s' "${SAN_NORM}" > "${STAMP}"
fi

run_next --experimental-https --experimental-https-key "${KEY}" --experimental-https-cert "${CRT}" -H 0.0.0.0
