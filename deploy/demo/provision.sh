#!/usr/bin/env bash
# Creates the Azure resources for the What's On TV demo. Idempotent: re-running
# skips anything that already exists. Needs the Azure CLI, signed in (az login).
#
# THIS CREATES BILLABLE RESOURCES: one Standard_B2s VM (~US$30/month) with a
# 128 GB disk and a static public IP, plus outbound bandwidth beyond the free
# allowance. Delete everything with:  az group delete -n "$RESOURCE_GROUP"
#
# Settings (environment variables):
#   RESOURCE_GROUP   default whatson-demo
#   LOCATION         default eastus
#   VM_NAME          default whatson-demo
#   SSH_PUBLIC_KEY   default ~/.ssh/id_ed25519.pub (falls back to id_rsa.pub)
#   SSH_SOURCE       IP or CIDR allowed to SSH in; default: this machine's public IP
#   DNS_ZONE         default whatsontv.net (A record "demo" is added if Azure hosts the zone)
#   BUDGET_AMOUNT    optional monthly budget in the subscription currency, e.g. 60
#   BUDGET_EMAIL     where budget alerts go (required with BUDGET_AMOUNT)
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-whatson-demo}"
LOCATION="${LOCATION:-eastus}"
VM_NAME="${VM_NAME:-whatson-demo}"
DNS_ZONE="${DNS_ZONE:-whatsontv.net}"
HERE="$(cd "$(dirname "$0")" && pwd)"

SSH_PUBLIC_KEY="${SSH_PUBLIC_KEY:-}"
if [ -z "$SSH_PUBLIC_KEY" ]; then
  for k in ~/.ssh/id_ed25519.pub ~/.ssh/id_rsa.pub; do
    [ -f "$k" ] && SSH_PUBLIC_KEY="$k" && break
  done
fi
[ -n "$SSH_PUBLIC_KEY" ] && [ -f "$SSH_PUBLIC_KEY" ] || { echo "No SSH public key found; set SSH_PUBLIC_KEY." >&2; exit 1; }

if [ -z "${SSH_SOURCE:-}" ]; then
  SSH_SOURCE="$(curl -fsS https://api.ipify.org)/32"
fi
echo "SSH will be allowed only from $SSH_SOURCE"

echo "== Resource group $RESOURCE_GROUP ($LOCATION)"
az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none

NSG="$VM_NAME-nsg"
echo "== Network security group $NSG"
az network nsg create -g "$RESOURCE_GROUP" -n "$NSG" -o none
az network nsg rule create -g "$RESOURCE_GROUP" --nsg-name "$NSG" -n allow-web --priority 100 \
  --access Allow --protocol '*' --direction Inbound --destination-port-ranges 80 443 -o none
az network nsg rule create -g "$RESOURCE_GROUP" --nsg-name "$NSG" -n allow-ssh-admin --priority 110 \
  --access Allow --protocol Tcp --direction Inbound --destination-port-ranges 22 \
  --source-address-prefixes "$SSH_SOURCE" -o none

if az vm show -g "$RESOURCE_GROUP" -n "$VM_NAME" -o none 2>/dev/null; then
  echo "== VM $VM_NAME already exists"
else
  echo "== VM $VM_NAME"
  az vm create -g "$RESOURCE_GROUP" -n "$VM_NAME" \
    --image Canonical:ubuntu-24_04-lts:server:latest \
    --size Standard_B2s \
    --os-disk-size-gb 128 \
    --admin-username whatson \
    --ssh-key-values "$SSH_PUBLIC_KEY" \
    --public-ip-sku Standard \
    --public-ip-address-allocation static \
    --nsg "$NSG" \
    --custom-data "$HERE/cloud-init.yaml" \
    -o none
fi

IP="$(az vm show -d -g "$RESOURCE_GROUP" -n "$VM_NAME" --query publicIps -o tsv)"
echo "== Public IP: $IP"

ZONE_RG="$(az network dns zone list --query "[?name=='$DNS_ZONE'].resourceGroup | [0]" -o tsv 2>/dev/null || true)"
if [ -n "$ZONE_RG" ]; then
  echo "== DNS: demo.$DNS_ZONE -> $IP (zone in $ZONE_RG)"
  az network dns record-set a create -g "$ZONE_RG" -z "$DNS_ZONE" -n demo --ttl 300 -o none 2>/dev/null || true
  # Replace any previous address with the current one.
  for old in $(az network dns record-set a show -g "$ZONE_RG" -z "$DNS_ZONE" -n demo --query "ARecords[].ipv4Address" -o tsv); do
    [ "$old" = "$IP" ] || az network dns record-set a remove-record -g "$ZONE_RG" -z "$DNS_ZONE" -n demo -a "$old" --keep-empty-record-set -o none
  done
  az network dns record-set a add-record -g "$ZONE_RG" -z "$DNS_ZONE" -n demo -a "$IP" -o none 2>/dev/null || true
else
  echo "== DNS: zone $DNS_ZONE is not in this Azure subscription."
  echo "   Add an A record  demo.$DNS_ZONE -> $IP  at your DNS host."
fi

if [ -n "${BUDGET_AMOUNT:-}" ]; then
  [ -n "${BUDGET_EMAIL:-}" ] || { echo "BUDGET_EMAIL is required with BUDGET_AMOUNT" >&2; exit 1; }
  echo "== Monthly budget $BUDGET_AMOUNT on $RESOURCE_GROUP (alert at 80%)"
  START="$(date -u +%Y-%m-01)"
  az consumption budget create -g "$RESOURCE_GROUP" --budget-name "$RESOURCE_GROUP-monthly" \
    --amount "$BUDGET_AMOUNT" --category cost --time-grain monthly \
    --start-date "$START" --end-date 2030-12-31 \
    --notifications "{\"Actual_GreaterThan_80_Percent\":{\"enabled\":true,\"operator\":\"GreaterThan\",\"threshold\":80,\"contactEmails\":[\"$BUDGET_EMAIL\"]}}" \
    -o none || echo "   (budget not created; add one in Cost Management instead)"
fi

cat <<EOF

Done. Next steps (README.md):
  ssh whatson@$IP
  cd /srv/whatson/deploy/demo && cp .env.example .env && nano .env
EOF
