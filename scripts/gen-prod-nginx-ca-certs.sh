#!/usr/bin/env bash
# 为生产 Nginx（:21911）生成本地 CA + 由其签发的服务端证书。
# 客户端把 ca.crt 导入「受信任的根证书」后，访问 https://<IP>:21911 不再提示不安全。
#
# 用法:
#   ./scripts/gen-prod-nginx-ca-certs.sh              # 缺证书才生成；SAN 默认 SITE_LAN_HOST + 127.0.0.1
#   ./scripts/gen-prod-nginx-ca-certs.sh --force       # 重新签发服务端证书（保留已有 CA）
#   ./scripts/gen-prod-nginx-ca-certs.sh --force-ca    # 重建 CA 并签发服务端证书（各客户端需重装 ca.crt）
#   CERT_SAN_IPS="192.168.18.141,192.168.28.9" ./scripts/gen-prod-nginx-ca-certs.sh --force
#
# 生成后需重启 Nginx，例如:
#   NGINX_IMAGE=nginx:alpine ./prod-start-nginx.sh --no-build --restart
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/site-host.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/site-host.env"
fi

FORCE_SERVER=0
FORCE_CA=0
for a in "$@"; do
  case "$a" in
    --force) FORCE_SERVER=1 ;;
    --force-ca) FORCE_CA=1; FORCE_SERVER=1 ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数: $a（支持 --force / --force-ca）" >&2
      exit 1
      ;;
  esac
done

CERT_DIR="$ROOT/docker/nginx/certs"
CA_KEY="$CERT_DIR/ca.key"
CA_CRT="$CERT_DIR/ca.crt"
SERVER_KEY="$CERT_DIR/server.key"
SERVER_CRT="$CERT_DIR/server.crt"
SERVER_CSR="$CERT_DIR/server.csr"
OPENSSL_CNF="$CERT_DIR/openssl-server.cnf"
CA_SRL="$CERT_DIR/ca.srl"

mkdir -p "$CERT_DIR"

host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "${host_ip:-}" ]] || host_ip="127.0.0.1"
DEFAULT_SAN="${SITE_LAN_HOST:-$host_ip}"

# 收集 SAN IP：CERT_SAN_IPS > 默认现场 IP + 本机首选 IP + 127.0.0.1
SAN_LIST=()
if [[ -n "${CERT_SAN_IPS:-}" ]]; then
  IFS=',' read -r -a _raw <<< "${CERT_SAN_IPS}"
  for ip in "${_raw[@]}"; do
    ip="$(echo "$ip" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "$ip" ]] && SAN_LIST+=("$ip")
  done
else
  SAN_LIST+=("$DEFAULT_SAN")
  [[ "$host_ip" != "$DEFAULT_SAN" ]] && SAN_LIST+=("$host_ip")
  SAN_LIST+=("127.0.0.1")
fi

# 去重保序
DEDUPED=()
for ip in "${SAN_LIST[@]}"; do
  skip=0
  for d in "${DEDUPED[@]:-}"; do
    [[ "$d" == "$ip" ]] && { skip=1; break; }
  done
  [[ "$skip" -eq 0 ]] && DEDUPED+=("$ip")
done
SAN_LIST=("${DEDUPED[@]}")
CN="${SAN_LIST[0]}"

need_ca=0
need_server=0
[[ "$FORCE_CA" -eq 1 || ! -f "$CA_KEY" || ! -f "$CA_CRT" ]] && need_ca=1
[[ "$FORCE_SERVER" -eq 1 || ! -f "$SERVER_KEY" || ! -f "$SERVER_CRT" ]] && need_server=1

# 已有自签叶子、无 CA：提示用 --force 换成 CA 签发
if [[ "$need_ca" -eq 0 && "$need_server" -eq 0 ]]; then
  if ! openssl verify -CAfile "$CA_CRT" "$SERVER_CRT" >/dev/null 2>&1; then
    echo "已有 server.crt 但并非本 CA 签发（多为旧自签）。" >&2
    echo "请执行: $0 --force" >&2
    exit 1
  fi
  echo "证书已就绪（CA + 服务端），无需重生。"
  echo "  CA:     $CA_CRT"
  echo "  Server: $SERVER_CRT"
  openssl x509 -in "$SERVER_CRT" -noout -subject -dates -ext subjectAltName 2>/dev/null || true
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "错误: 未找到 openssl" >&2
  exit 1
fi

if [[ "$need_ca" -eq 1 ]]; then
  echo "生成本地 CA（10 年）..."
  openssl req -x509 -new -nodes -newkey rsa:4096 \
    -keyout "$CA_KEY" \
    -out "$CA_CRT" \
    -days 3650 \
    -subj "/O=NexusUI/OU=Local/CN=NexusUI Prod Nginx CA"
  chmod 600 "$CA_KEY"
  need_server=1
fi

if [[ "$need_server" -eq 1 ]]; then
  echo "签发服务端证书（CN=${CN}，SAN: ${SAN_LIST[*]}）..."
  {
    echo '[req]'
    echo 'distinguished_name = req_distinguished_name'
    echo 'req_extensions = v3_req'
    echo 'prompt = no'
    echo '[req_distinguished_name]'
    echo "CN = ${CN}"
    echo 'O = NexusUI'
    echo '[v3_req]'
    echo 'basicConstraints = CA:FALSE'
    echo 'keyUsage = digitalSignature, keyEncipherment'
    echo 'extendedKeyUsage = serverAuth'
    echo 'subjectAltName = @alt_names'
    echo '[alt_names]'
    i=1
    for ip in "${SAN_LIST[@]}"; do
      echo "IP.${i} = ${ip}"
      i=$((i + 1))
    done
  } > "$OPENSSL_CNF"

  openssl req -new -nodes -newkey rsa:2048 \
    -keyout "$SERVER_KEY" \
    -out "$SERVER_CSR" \
    -config "$OPENSSL_CNF"
  chmod 600 "$SERVER_KEY"

  openssl x509 -req \
    -in "$SERVER_CSR" \
    -CA "$CA_CRT" \
    -CAkey "$CA_KEY" \
    -CAcreateserial \
    -out "$SERVER_CRT" \
    -days 3650 \
    -extfile "$OPENSSL_CNF" \
    -extensions v3_req

  rm -f "$SERVER_CSR"
  openssl verify -CAfile "$CA_CRT" "$SERVER_CRT"
fi

echo ""
echo "✅ 生产 Nginx 证书已写入 ${CERT_DIR}"
echo "  ca.crt     → 发给每台访问电脑，导入「受信任的根证书颁发机构」（只需一次）"
echo "  server.crt / server.key → Nginx 使用（已挂载 docker/nginx/certs）"
echo ""
echo "Windows 导入 ca.crt（管理员 PowerShell 示例）:"
echo "  Import-Certificate -FilePath .\\ca.crt -CertStoreLocation Cert:\\LocalMachine\\Root"
echo "或: 双击 ca.crt → 安装证书 → 本地计算机 → 受信任的根证书颁发机构"
echo ""
echo "导入后重启浏览器，再访问 https://${CN}:21911/"
echo "若 Nginx 已在跑，需重载证书容器，例如:"
echo "  NGINX_IMAGE=nginx:alpine ./prod-start-nginx.sh --no-build --restart"
echo ""
openssl x509 -in "$SERVER_CRT" -noout -subject -dates -ext subjectAltName 2>/dev/null || true
