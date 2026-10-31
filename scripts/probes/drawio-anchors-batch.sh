#!/usr/bin/env bash
# drawio-wire-anchors: several different diagrams through one model, one turn each, each file
# checked by the probe itself afterwards. Output per run in $OUT (default ./drawio-anchors-batch).
#   scripts/probes/drawio-anchors-batch.sh [provider/model]
set -u
MODEL="${1:-mistral/codestral-latest}"
OUT="${OUT:-drawio-anchors-batch}"
mkdir -p "$OUT"
cd "$(dirname "$0")/../.."
prompts=(
  "Dessine dans diagrams/vehicule.drawio l'architecture électrique d'une voiture électrique : Batterie, BMS, Onduleur, Moteur, Chargeur embarqué, Prise de recharge, Convertisseur DC/DC, Réseau 12 V. Étiquette chaque flux : la Batterie envoie « puissance HT » à l'Onduleur et au Convertisseur DC/DC ; le BMS envoie « mesures cellules » et « ordre de coupure » à la Batterie ; l'Onduleur envoie « courant triphasé » au Moteur ; le Moteur renvoie « régénération » à l'Onduleur ; la Prise envoie « courant AC » au Chargeur, qui envoie « charge » à la Batterie ; le Convertisseur alimente le Réseau 12 V."
  "Dessine dans diagrams/commande.drawio l'organigramme du traitement d'une commande : Réception, décision « Stock disponible ? » (oui : Paiement ; non : Réapprovisionnement puis retour à la décision), décision « Paiement accepté ? » (oui : Préparation puis Expédition ; non : Annulation), et une Notification client envoyée depuis Expédition et depuis Annulation."
  "Dessine dans diagrams/reseau.drawio le réseau d'une PME : Internet, Pare-feu, Routeur, Commutateur, Serveur web, Serveur de fichiers, Serveur de messagerie, NAS de sauvegarde, Postes de travail. Étiquette les liens : « HTTPS » et « SMTP » d'Internet au Pare-feu, « LAN » entre Pare-feu et Routeur, « VLAN serveurs » et « VLAN postes » depuis le Commutateur, « sauvegarde nocturne » des trois serveurs vers le NAS."
  "Dessine dans diagrams/services.drawio une architecture de microservices : Passerelle API, Authentification, Commandes, Paiements, Notifications, File de messages, Base de données. La Passerelle envoie « jeton » à Authentification, « requête commande » à Commandes et « requête paiement » à Paiements ; Commandes publie « commande créée » et Paiements publie « paiement reçu » dans la File de messages ; Notifications consomme « commande créée » et « paiement reçu » depuis la File ; Commandes et Paiements lisent et écrivent la Base de données (« lecture », « écriture »)."
)
for i in "${!prompts[@]}"; do
  n=$((i + 1))
  echo "### run $n/${#prompts[@]} start"
  node --import tsx/esm scripts/probes/drawio-anchors-live.mjs "$MODEL" "${prompts[$i]}" > "$OUT/run-$n.txt" 2>&1
  grep -E "^=== (turn|final|no |refreshed|the real|could not)|^  (warning|error):|still running|model error" "$OUT/run-$n.txt" | sed "s/^/[run $n] /"
done
echo "### batch done"
