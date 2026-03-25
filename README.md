# GARD - Genesys Automated Recording Downloader

Um script de automação robusto para baixar e organizar gravações de chamadas do Genesys Cloud em massa. A ferramenta suporta downloads baseados em filas ou listas personalizadas de IDs, com suporte automático a grandes volumes e organização estruturada.

## 🚀 Novas Funcionalidades

-   **Múltiplos Métodos de Download:**
    -   **Por Fila:** Filtre por intervalo de datas e fila específica.
    -   **Por Lista de IDs:** Importe um arquivo (`.txt`, `.csv`) com IDs de conversas. Suporta o formato `Dia;ID` para organização automática.
-   **Superação do Limite de 100 Itens:** O script divide automaticamente grandes solicitações em múltiplos lotes (chunks) para contornar o limite nativo da API do Genesys Cloud.
-   **Organização Inteligente:**
    -   **Pastas de Sessão:** Cada execução cria uma subpasta única com timestamp em `Recordings/` (ex: `2026-03-25_13-45-10`).
    -   **Subpastas por Dia:** Opção automática para organizar arquivos em pastas `Dia_X` ou por data (`YYYY-MM-DD`) ao final do download.
-   **Sistema de Logs Auditáveis:**
    -   **Success Log:** Lista de arquivos baixados com sucesso.
    -   **Retry Log (`failed_*.txt`):** Gera automaticamente uma lista limpa apenas com os IDs que falharam, pronta para ser re-importada e baixada novamente após correções.
-   **Conversão de Áudio:** Converte `.ogg` nativo para `.wav` ou `.mp3` via FFmpeg.

## 📋 Pré-requisitos

1.  **[Node.js](https://nodejs.org/) (v18+).**
2.  **[FFmpeg](https://ffmpeg.org/download.html)** instalado e no PATH do sistema.
3.  **Credenciais OAuth (Client Credentials):** Criar em `Admin > Integrations > OAuth`.
    -   **Permissões Necessárias:**
        -   `analytics:conversationDetail:view`
        -   `recording:recording:allpermissions`
        -   `routing:queue:view`.

## 🛠️ Instalação e Configuração

1.  **Clone o repositório:**
    ```bash
    git clone https://github.com/yvssva/gard.git
    cd gard
    ```
2.  **Instale as dependências:** `npm install`
3.  **Configuração:** Renomeie `config.js.example` para `config.js` e insira suas credenciais.

## 📖 Como Usar

Execute `npm start` e siga o menu interativo:
1.  Selecione a **Região**.
2.  Escolha o **Método de Download** (Fila ou Lista de IDs).
3.  Se usar lista, informe o arquivo que deve estar no mesmo diretório do script (ex: `ids.csv`). O script aceita `ID` puro ou `Dia;ID`.
4.  Escolha o **Formato Final** (WAV é recomendado para máxima qualidade).
5.  Ao final, confirme se deseja **Organizar em Subpastas**.

## 📊 Estrutura de Arquivos Gerada

```text
gard/
├── Recordings/
│   └── YYYY-MM-DD_HH-mm-ss/  <-- Pasta da Sessão
│       ├── Dia_1/            <-- Organização Automática
│       │   └── ConvID_RecID.wav
│       └── Dia_2/
├── Logs/
│   ├── success_*.txt
│   ├── failed_*.txt          <-- Use este para retentativas!
│   └── failed_details_*.csv
```

## ⚖️ Licença

Este projeto está sob a licença MIT.