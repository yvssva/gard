# GARD - Genesys Automated Recording Downloader

Um script de automação para baixar e converter gravações de chamadas do Genesys Cloud em lote. A ferramenta permite selecionar um intervalo de datas, uma fila específica e o formato de áudio final (OGG, WAV ou MP3).

## Funcionalidades

-   **Autenticação Segura:** Utiliza credenciais OAuth (Client Credentials).
-   **Seleção de Região:** Suporte para diferentes regiões do Genesys Cloud.
-   **Filtros Avançados:** Baixe gravações por fila e intervalo de datas.
-   **Conversão de Formato:** Opção para converter os arquivos `.ogg` nativos para `.wav` ou `.mp3` automaticamente após o download.
-   **Processo em Lote:** Otimizado para baixar um grande número de gravações de forma eficiente.

## Pré-requisitos

Antes de começar, garanta que você tenha os seguintes softwares instalados:

1.  **[Node.js](https://nodejs.org/) (v18 ou superior):** Ambiente de execução para o script.
2.  **[FFmpeg](https://ffmpeg.org/download.html):** Ferramenta essencial para a conversão de áudio. A maneira mais fácil de instalar no Windows é usando o gerenciador de pacotes [Chocolatey](https://chocolatey.org/):
    ```powershell
    choco install ffmpeg
    ```
3.  **Credenciais OAuth do Genesys Cloud:** Você precisará de um `Client ID` e `Client Secret` com as permissões necessárias. Crie em `Admin > Integrations > OAuth`. As permissões mínimas recomendadas são:
    -   `recording:recording:view`
    -   `recording:recordingSegment:view`
    -   `analytics:conversationDetail:view`
    -   `routing:queue:view`

## Instalação

1.  **Clone o repositório:**
    ```bash
    git clone [https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git](https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git)
    cd SEU_REPOSITORIO
    ```

2.  **Instale as dependências do Node.js:**
    ```bash
    npm install
    ```

3.  **Configure suas credenciais:**
    -   Renomeie o arquivo `config.js.example` para `config.js`.
    -   Abra o arquivo `config.js` e insira seu `Client ID` e `Client Secret` obtidos do Genesys Cloud.

    ```javascript
    // config.js
    const clientId = 'SEU_CLIENT_ID_AQUI';
    const clientSecret = 'SEU_CLIENT_SECRET_AQUI';
    ```

## Como Usar

Execute o script a partir do seu terminal. É recomendado executá-lo em um terminal com privilégios de administrador para garantir que o FFmpeg funcione corretamente.

```bash
npm start
```

O script irá guiá-lo interativamente através dos seguintes passos:
1.  Seleção da região do Genesys Cloud.
2.  Seleção do intervalo de datas.
3.  Seleção da fila.
4.  Seleção do formato de áudio final desejado (OGG, WAV ou MP3).

Os arquivos serão baixados na pasta `Recordings`, e a conversão (se selecionada) ocorrerá automaticamente.

## Como Funciona

1.  O script se autentica na API do Genesys Cloud.
2.  Busca as conversas que correspondem aos filtros de data e fila.
3.  Para cada conversa, obtém os metadados das gravações disponíveis.
4.  Cria um pedido em lote (batch request) para baixar todos os arquivos de áudio no formato nativo `.ogg`.
5.  Após o download, se o formato selecionado for `WAV` ou `MP3`, ele chama um script PowerShell (`convert.ps1`) que utiliza o **FFmpeg** para converter cada arquivo `.ogg` para o formato desejado, removendo o original em seguida.

## Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.