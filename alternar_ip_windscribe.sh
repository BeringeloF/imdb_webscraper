#!/bin/bash

# Verificar se um código de país foi passado como parâmetro
if [ -z "$1" ]; then
  echo "Por favor, forneça o código do país para conectar à VPN."
  echo "Exemplo: ./alternar_ip_windscribe.sh us"
  exit 1
fi

# Desconectar da VPN (se já estiver conectado)
windscribe-cli disconnect

# Conectar ao servidor especificado pelo código do país fornecido
windscribe-cli connect $1

