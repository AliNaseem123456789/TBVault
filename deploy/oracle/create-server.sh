#!/usr/bin/env bash
# Creates the chatbot server on Oracle Cloud (Always Free), all from the command line.
#
# Run it in Oracle Cloud Shell (the >_ icon at the top right of the Oracle console),
# which is already signed in to your account:
#   1. Cloud Shell menu (gear icon) -> Upload -> pick this file
#   2. bash create-server.sh
#
# What it makes (safe to run again: it reuses anything that already exists):
#   - a network (VCN) with a public subnet, internet access, and ports 22/80/443 open
#   - an SSH key pair in ~/.ssh/tbvault-oracle.key (download it to your PC afterwards)
#   - an Ubuntu 22.04 ARM server: VM.Standard.A1.Flex, 4 CPUs, 24 GB RAM (the whole free allowance)
# At the end it prints the server's public IP.
#
# Free ARM servers are often "out of capacity". To keep retrying every 5 minutes until one
# is free (keep the Cloud Shell tab open):  bash create-server.sh --keep-trying
set -euo pipefail

NAME=tbvault-chatbot
SHAPE=VM.Standard.A1.Flex
KEY=~/.ssh/tbvault-oracle.key
KEEP_TRYING=false
[[ "${1:-}" == "--keep-trying" ]] && KEEP_TRYING=true

say() { echo -e "\n==> $*"; }
# Prints the value, or nothing when the query found nothing.
value() { local v; v=$("$@" 2>/dev/null || true); [[ "$v" == "null" ]] && v=""; echo "$v"; }

# Everything goes in the root compartment (the tenancy), the simplest choice for one server.
C="${OCI_TENANCY:-}"
if [[ -z "$C" ]]; then
    C=$(oci iam compartment list --include-root --compartment-id-in-subtree true --all \
        --query "data[?starts_with(id, 'ocid1.tenancy')] | [0].id" --raw-output)
fi
echo "Compartment: $C"

# ---------------------------------------------------------------- network
say "Network"
VCN=$(value oci network vcn list -c "$C" --display-name tbvault-vcn --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output)
if [[ -z "$VCN" ]]; then
    VCN=$(oci network vcn create -c "$C" --display-name tbvault-vcn --cidr-blocks '["10.0.0.0/16"]' \
        --dns-label tbvault --wait-for-state AVAILABLE --query 'data.id' --raw-output)
    echo "created VCN"
else
    echo "reusing VCN"
fi

IGW=$(value oci network internet-gateway list -c "$C" --vcn-id "$VCN" --query 'data[0].id' --raw-output)
if [[ -z "$IGW" ]]; then
    IGW=$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true \
        --display-name tbvault-igw --wait-for-state AVAILABLE --query 'data.id' --raw-output)
    echo "created internet gateway"
fi

# Send all outside traffic through the internet gateway.
RT=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
oci network route-table update --rt-id "$RT" --force --wait-for-state AVAILABLE >/dev/null \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]"

# Firewall (Oracle side): allow SSH, HTTP and HTTPS in; anything out.
SL=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)
port() { echo "{\"protocol\":\"6\",\"source\":\"0.0.0.0/0\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":$1,\"max\":$1}}}"; }
oci network security-list update --security-list-id "$SL" --force --wait-for-state AVAILABLE >/dev/null \
    --ingress-security-rules "[$(port 22),$(port 80),$(port 443)]" \
    --egress-security-rules '[{"protocol":"all","destination":"0.0.0.0/0"}]'
echo "ports 22, 80, 443 open"

SUBNET=$(value oci network subnet list -c "$C" --vcn-id "$VCN" --display-name tbvault-public --query 'data[0].id' --raw-output)
if [[ -z "$SUBNET" ]]; then
    SUBNET=$(oci network subnet create -c "$C" --vcn-id "$VCN" --display-name tbvault-public \
        --cidr-block 10.0.0.0/24 --dns-label public --wait-for-state AVAILABLE --query 'data.id' --raw-output)
    echo "created public subnet"
fi

# ---------------------------------------------------------------- SSH key
say "SSH key"
if [[ ! -f "$KEY" ]]; then
    mkdir -p ~/.ssh
    ssh-keygen -t rsa -b 4096 -N "" -C tbvault-oracle -f "$KEY" >/dev/null
    echo "created $KEY"
else
    echo "reusing $KEY"
fi

# ---------------------------------------------------------------- server
say "Server"
# A server from an earlier run counts in any state except deleted, so we never make two.
ID=$(value oci compute instance list -c "$C" --display-name "$NAME" \
    --query "data[?\"lifecycle-state\" != 'TERMINATED' && \"lifecycle-state\" != 'TERMINATING'] | [0].id" --raw-output)

if [[ -z "$ID" ]]; then
    # Newest Ubuntu 22.04 build that runs on ARM (the --shape filter picks the aarch64 build).
    IMAGE=$(oci compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "22.04" \
        --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --all \
        --query "data[?!contains(\"display-name\", 'Minimal')] | [0].id" --raw-output)
    echo "image: $(oci compute image get --image-id "$IMAGE" --query 'data."display-name"' --raw-output)"

    # Ubuntu on Oracle blocks ports 80/443 in its own firewall too; this opens them on first boot.
    CLOUD_INIT=$(mktemp)
    cat > "$CLOUD_INIT" <<'EOF'
#!/bin/bash
line=$(iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')
iptables -I INPUT "${line:-1}" -p tcp --dport 443 -m state --state NEW -j ACCEPT
iptables -I INPUT "${line:-1}" -p tcp --dport 80 -m state --state NEW -j ACCEPT
netfilter-persistent save
EOF

    ADS=$(oci iam availability-domain list -c "$C" --query "join(' ', data[].name)" --raw-output)

    # Free ARM servers are popular, so a zone can be "out of capacity". Try every zone with
    # 4 CPU / 24 GB, then 2 CPU / 12 GB, then 1 CPU / 6 GB (enough for the chatbot).
    try_launch() {
        for SIZE in '{"ocpus":4,"memoryInGBs":24}' '{"ocpus":2,"memoryInGBs":12}' '{"ocpus":1,"memoryInGBs":6}'; do
            for AD in $ADS; do
                echo "$(date +%H:%M) trying $AD with $SIZE ..."
                if OUT=$(oci compute instance launch -c "$C" --availability-domain "$AD" --display-name "$NAME" \
                        --shape "$SHAPE" --shape-config "$SIZE" --image-id "$IMAGE" --subnet-id "$SUBNET" \
                        --assign-public-ip true --ssh-authorized-keys-file "$KEY.pub" --user-data-file "$CLOUD_INIT" \
                        --wait-for-state RUNNING --max-wait-seconds 900 --query 'data.id' --raw-output 2>&1); then
                    ID=$(echo "$OUT" | grep -o 'ocid1\.instance[^" ]*' | head -1)
                    return 0
                fi
                if echo "$OUT" | grep -qi "capacity"; then
                    echo "  out of capacity there"
                else
                    echo "$OUT" >&2
                    exit 1
                fi
            done
        done
        return 1
    }

    until try_launch; do
        if ! $KEEP_TRYING; then break; fi
        echo "  no luck; trying again in 5 minutes (Ctrl+C to stop)"
        sleep 300
    done
    rm -f "$CLOUD_INIT"

    if [[ -z "$ID" ]]; then
        echo -e "\nOracle has no free ARM capacity right now. To keep retrying automatically, run:  bash create-server.sh --keep-trying"
        exit 1
    fi
    echo "server created"
else
    echo "reusing the server from an earlier run (state: $(oci compute instance get --instance-id "$ID" --query 'data."lifecycle-state"' --raw-output))"
fi

IP=$(oci compute instance list-vnics --instance-id "$ID" --query 'data[0]."public-ip"' --raw-output)

say "Done"
echo "Public IP:  $IP"
echo
echo "Next: download the private key to your PC."
echo "  Cloud Shell menu (gear icon) -> Download -> type:  .ssh/tbvault-oracle.key"
echo "  Save it as C:\\Users\\<you>\\.ssh\\tbvault-oracle.key"
echo "Then send Claude the IP above and that path."
