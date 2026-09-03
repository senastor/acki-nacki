#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_green() { echo -e "${GREEN}$1${NC}"; }
print_yellow() { echo -e "${YELLOW}$1${NC}"; }
print_red() { echo -e "${RED}$1${NC}"; }

create_configs() {
  if [ ! -f .env ]; then
    cp .env.example .env
    print_green "Created .env from .env.example (edit with your TG bot token)"
  fi
  for f in datas.txt proxies.txt wallets.txt; do
    if [ ! -f "$f" ]; then
      touch "$f"
      print_green "Created $f"
    fi
  done
}

while true; do
  clear
  echo "============================================================"
  echo "      Acki-Nacki Auto Bot - Setup and Run"
  echo "============================================================"
  echo
  echo "Current directory: $(pwd)"
  echo
  echo "1. Create/Check Config Files"
  echo "2. Run the Bot"
  echo "3. Exit"
  echo
  read -p "Enter choice (1-3): " choice

  case "$choice" in
    1)
      clear
      create_configs
      print_yellow "Please fill datas.txt with your session data before running."
      read -p "Press Enter to continue..."
      ;;
    2)
      clear
      if [ ! -f datas.txt ] || [ ! -s datas.txt ]; then
        print_red "datas.txt is empty. Run option 1 and add your session data first."
        read -p "Press Enter to continue..."
        continue
      fi
      print_green "Starting the bot..."
      node bot.js
      read -p "Press Enter to continue..."
      ;;
    3)
      exit 0
      ;;
    *)
      print_red "Invalid choice"
      ;;
  esac
done
