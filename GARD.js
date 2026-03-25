const { platformClient, clientId, clientSecret } = require('./config');
const prompts = require('prompts');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const client = platformClient.ApiClient.instance;
const conversationsApi = new platformClient.ConversationsApi();
const recordingApi = new platformClient.RecordingApi();
const routingApi = new platformClient.RoutingApi();

client.setEnvironment('sae1.pure.cloud');

async function authenticate() {
    try {
        const authResponse = await client.loginClientCredentialsGrant(clientId, clientSecret);
        console.log('✅ Autenticação realizada com sucesso!');
        return authResponse.accessToken;
    } catch (error) {
        console.error('❌ Erro na autenticação:', error.message);
        process.exit(1);
    }
}

async function selectRegion() {
    const regions = [
        { title: 'EUA (mypurecloud.com)', value: 'mypurecloud.com' },
        { title: 'SAO_PAULO (sae1.pure.cloud)', value: 'sae1.pure.cloud' }
    ];
    const response = await prompts({
        type: 'select',
        name: 'region',
        message: 'Escolha a região:',
        choices: regions
    });
    client.setEnvironment(response.region);
    console.log(`✅ Região selecionada: ${response.region}`);
    return response.region;
}

async function selectDateRange() {
    const response = await prompts([
        {
            type: 'text',
            name: 'startDate',
            message: 'Data de início (YYYY-MM-DD):',
            validate: value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? true : 'Formato inválido (use YYYY-MM-DD)'
        },
        {
            type: 'text',
            name: 'endDate',
            message: 'Data de fim (YYYY-MM-DD):',
            validate: value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? true : 'Formato inválido (use YYYY-MM-DD)'
        }
    ]);
    console.log(`✅ Intervalo selecionado: ${response.startDate} até ${response.endDate}`);
    return response;
}

async function selectDownloadMethod() {
    const response = await prompts({
        type: 'select',
        name: 'method',
        message: 'Escolha o método de download:',
        choices: [
            { title: 'Por Fila (Baseado em datas)', value: 'queue' },
            { title: 'Por Lista de IDs (Arquivo .txt, .csv, etc)', value: 'list' }
        ]
    });
    console.log(`✅ Método de download selecionado: ${response.method === 'queue' ? 'Fila' : 'Lista de IDs'}`);
    return response.method;
}

async function getConversationIdsFromFile() {
    const response = await prompts({
        type: 'text',
        name: 'filename',
        message: 'Informe o nome do arquivo com os IDs (ex: ids.txt ou ids.csv) na pasta atual:',
        validate: value => value.trim().length > 0 ? true : 'O nome do arquivo é obrigatório'
    });
    
    try {
        const filePath = path.join(__dirname, response.filename.trim());
        if (!existsSync(filePath)) {
            console.error(`❌ Arquivo não encontrado: ${filePath}`);
            process.exit(1);
        }
        const fileContent = await fs.readFile(filePath, 'utf8');
        const lines = fileContent.split(/[\r\n]+/).filter(l => l.trim().length > 0);
        
        const conversationIds = [];
        const idToDayMap = new Map();

        for (let line of lines) {
            // Tenta detectar separador (ponto e vírgula ou vírgula)
            if (line.includes(';') || line.includes(',')) {
                const parts = line.split(/[;,]/).map(p => p.trim());
                // Assume formato Dia;ID ou ID;Dia (detecta UUID)
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                
                let id = parts.find(p => uuidRegex.test(p));
                let day = parts.find(p => !uuidRegex.test(p) && p.toLowerCase() !== 'dia' && p.toLowerCase() !== 'id');

                if (id) {
                    conversationIds.push(id);
                    if (day) idToDayMap.set(id, day);
                }
            } else {
                const id = line.trim();
                if (id.length > 0) conversationIds.push(id);
            }
        }
        
        const uniqueIds = [...new Set(conversationIds)];
        console.log(`✅ Lidos ${uniqueIds.length} IDs únicos do arquivo.`);
        if (idToDayMap.size > 0) console.log(`ℹ️ Encontrado mapeamento de dias para ${idToDayMap.size} IDs.`);
        
        return { conversationIds: uniqueIds, idToDayMap };
    } catch (error) {
        console.error('❌ Erro ao ler arquivo de IDs:', error.message);
        process.exit(1);
    }
}

async function selectQueue() {
    try {
        console.log('\n=== CARREGANDO FILAS DISPONÍVEIS ===');
        const queues = await routingApi.getRoutingQueues({ pageSize: 100 });
        console.log('\n=== FILAS DISPONÍVEIS ===');
        queues.entities.forEach((queue, index) => {
            console.log(`${index + 1}. ${queue.name} (ID: ${queue.id})`);
        });
        const response = await prompts({
            type: 'number',
            name: 'queueIndex',
            message: 'Escolha o número da fila:',
            validate: value => value > 0 && value <= queues.entities.length ? true : 'Número inválido'
        });
        const selectedQueue = queues.entities[response.queueIndex - 1];
        console.log(`✅ Fila selecionada: ${selectedQueue.name}`);
        return selectedQueue.id;
    } catch (error) {
        console.error('❌ Erro ao carregar filas:', error.message);
        process.exit(1);
    }
}

async function selectAudioFormat() {
    const formats = [
        { title: 'OGG (padrão, mais rápido)', value: 'OGG' },
        { title: 'WAV (convertido, sem compressão)', value: 'WAV' },
        { title: 'MP3 (convertido, com compressão)', value: 'MP3' }
    ];
    const response = await prompts({
        type: 'select',
        name: 'format',
        message: 'Escolha o formato de áudio final:',
        choices: formats
    });
    console.log(`✅ Formato final selecionado: ${response.format}`);
    return response.format;
}

async function getConversationsWithRecordings(queueId, startDate, endDate) {
    try {
        console.log('\n=== BUSCANDO CONVERSAS COM GRAVAÇÕES ===');
        const conversations = await conversationsApi.postAnalyticsConversationsDetailsQuery({
            interval: `${startDate}T00:00:00.000Z/${endDate}T23:59:59.999Z`,
            order: 'desc',
            orderBy: 'conversationStart',
            paging: { pageSize: 100, pageNumber: 1 },
            segmentFilters: [
                {
                    type: 'and',
                    predicates: [
                        { type: 'dimension', dimension: 'queueId', operator: 'matches', value: queueId },
                        { type: 'dimension', dimension: 'mediaType', operator: 'matches', value: 'voice' }
                    ]
                }
            ]
        });
        const conversationIds = (conversations.conversations || []).map(conv => conv.conversationId);
        const idToDayMap = new Map();
        
        (conversations.conversations || []).forEach(conv => {
            if (conv.conversationStart) {
                // Formato YYYY-MM-DD
                const date = conv.conversationStart.split('T')[0];
                idToDayMap.set(conv.conversationId, date);
            }
        });

        console.log(`✅ Encontradas ${conversationIds.length} conversas`);
        return { conversationIds, idToDayMap };
    } catch (error) {
        console.error('❌ Erro ao buscar conversas:', error.message);
        return { conversationIds: [], idToDayMap: new Map() };
    }
}

async function getRecordingsMetadata(conversationIds) {
    const recordings = [];
    for (const convId of conversationIds) {
        try {
            const metadata = await recordingApi.getConversationRecordingmetadata(convId);
            if (metadata && metadata.length > 0) {
                 console.log(`\n📊 Gravações encontradas para a conversa ${convId}: ${metadata.length}`);
                 metadata.forEach((rec, index) => {
                    console.log(`   - Gravação ${index + 1}: ID=${rec.id}, Estado=${rec.fileState || 'N/A'}`);
                    if (rec.fileState === 'AVAILABLE') {
                        recordings.push({ conversationId: convId, ...rec });
                    } else {
                        console.log(`   - ⚠️ Gravação ${rec.id} ignorada. Estado: ${rec.fileState}`);
                    }
                });
            }
        } catch (error) {
            if (error.status !== 404) {
                 console.error(`❌ Erro ao buscar metadados da conversa ${convId}:`, error.message);
            }
        }
    }
    return recordings;
}

async function createBatchRequests(recordings) {
    console.log('\n=== ADICIONANDO GRAVAÇÕES AOS LOTES PARA DOWNLOAD ===');
    const batchIds = [];
    const chunkSize = 100;

    for (let i = 0; i < recordings.length; i += chunkSize) {
        const chunk = recordings.slice(i, i + chunkSize);
        const batchRequest = {
            batchDownloadRequestList: chunk.map(rec => ({
                conversationId: rec.conversationId,
                recordingId: rec.id
            })),
            formatId: 'OGG'
        };

        try {
            const batchResponse = await recordingApi.postRecordingBatchrequests(batchRequest);
            chunk.forEach(rec => {
                console.log(`✅ Adicionado ao lote (Parte ${Math.floor(i / chunkSize) + 1}): ${rec.conversationId}_${rec.id}`);
            });
            batchIds.push(batchResponse.id);
        } catch (error) {
            console.error(`❌ Erro ao criar lote separando itens:`, error.message);
            process.exit(1);
        }
    }
    return batchIds;
}

async function checkBatchStatuses(batchIds, maxRetries = 60, retryInterval = 10000) {
    console.log('\n=== VERIFICANDO STATUS DOS LOTES DE DOWNLOAD ===');
    let allResults = [];
    
    for (let i = 0; i < batchIds.length; i++) {
        const batchId = batchIds[i];
        let retries = 0;
        let batchCompleted = false;
        
        while (retries < maxRetries && !batchCompleted) {
            try {
                const status = await recordingApi.getRecordingBatchrequest(batchId);
                const completed = (status.results || []).filter(r => r.resultUrl || r.errorMsg).length;
                console.log(`📊 Status do lote ${i + 1}/${batchIds.length}: ${completed}/${status.expectedResultCount}`);
                
                if (completed === status.expectedResultCount) {
                    allResults = allResults.concat(status.results || []);
                    batchCompleted = true;
                } else {
                    await new Promise(resolve => setTimeout(resolve, retryInterval));
                    retries++;
                }
            } catch (error) {
                console.error(`❌ Erro ao verificar status do lote ${i + 1}:`, error.message);
                await new Promise(resolve => setTimeout(resolve, retryInterval));
                retries++;
            }
        }
        
        if (!batchCompleted) {
            console.error(`❌ Tempo limite excedido para o lote ${i + 1}`);
        }
    }
    
    console.log('✅ Lotes de download processados!');
    return allResults;
}

async function downloadRecordings(batchResults) {
    console.log('\n=== PROCESSANDO DOWNLOADS ===');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0].replace('T', '_');
    const outputDir = path.join(__dirname, 'Recordings', timestamp);
    await fs.mkdir(outputDir, { recursive: true });
    const successfulDownloads = [];
    const failedDownloads = [];

    const downloadQueue = (batchResults || []).filter(result => result.resultUrl);

    for (const result of downloadQueue) {
        try {
            console.log(`⬇️ Baixando gravação (formato OGG): ${result.conversationId}_${result.recordingId}`);
            const response = await axios.get(result.resultUrl, { responseType: 'arraybuffer' });
            
            const fileName = `${result.conversationId}_${result.recordingId}.ogg`;
            const filePath = path.join(outputDir, fileName);
            await fs.writeFile(filePath, response.data);
            const fileSize = (response.data.length / 1024 / 1024).toFixed(2);
            console.log(`✅ Arquivo .ogg salvo: ${fileName} (${fileSize} MB)`);
            successfulDownloads.push(result);
        } catch (error) {
            console.error(`❌ Erro ao baixar ${result.conversationId}_${result.recordingId}:`, error.message);
            failedDownloads.push({
                conversationId: result.conversationId,
                recordingId: result.recordingId,
                errorMsg: error.message
            });
        }
    }
    
    (batchResults || []).filter(r => r.errorMsg).forEach(err => {
        console.warn(`⚠️ Erro no processamento da gravação ${err.conversationId}_${err.recordingId}: ${err.errorMsg}`);
        failedDownloads.push({
            conversationId: err.conversationId,
            recordingId: err.recordingId,
            errorMsg: err.errorMsg
        });
    });

    console.log(`\n🎉 Processo de download concluído!`);
    console.log(`📊 Total de gravações baixadas: ${successfulDownloads.length}`);
    console.log(`❌ Total de gravações com erro: ${failedDownloads.length}`);
    console.log(`📁 Arquivos salvos em: ${outputDir}`);

    // Criação dos Logs
    try {
        const logsDir = path.join(__dirname, 'Logs');
        if (!existsSync(logsDir)) {
            await fs.mkdir(logsDir);
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        if (successfulDownloads.length > 0) {
            const successLogPath = path.join(logsDir, `success_${timestamp}.txt`);
            const successContent = successfulDownloads.map(s => `${s.conversationId}_${s.recordingId}`).join('\n');
            await fs.writeFile(successLogPath, successContent);
            console.log(`📝 Log de sucesso gravado em: ./Logs/success_${timestamp}.txt`);
        }
        
        if (failedDownloads.length > 0) {
            const failedLogPath = path.join(logsDir, `failed_${timestamp}.txt`);
            // Apenas conversationIds únicos no arquivo para usar como lista de IDs depois
            const failedContent = [...new Set(failedDownloads.map(f => f.conversationId))].join('\n');
            await fs.writeFile(failedLogPath, failedContent);
            
            const detailedFailedLogPath = path.join(logsDir, `failed_details_${timestamp}.csv`);
            const detailedFailedContent = ['ConversationID,RecordingID,Reason'].concat(
                failedDownloads.map(f => `${f.conversationId},${f.recordingId},"${String(f.errorMsg).replace(/"/g, '""')}"`)
            ).join('\n');
            await fs.writeFile(detailedFailedLogPath, detailedFailedContent);
            
            console.log(`📝 Lista de IDs com falha gerada (para repetição) em: ./Logs/failed_${timestamp}.txt`);
            console.log(`📝 Detalhes dos erros gravados em: ./Logs/failed_details_${timestamp}.csv`);
        }
    } catch (logError) {
        console.error('❌ Erro ao salvar arquivos de log:', logError.message);
    }

    return outputDir;
}

async function organizeFilesByDay(outputDir, idToDayMap) {
    if (!idToDayMap || idToDayMap.size === 0) {
        console.log('⚠️ Nenhum mapeamento de data/dia encontrado para organizar.');
        return;
    }

    console.log('\n=== ORGANIZANDO ARQUIVOS POR DIA ===');
    try {
        const files = await fs.readdir(outputDir);
        let movedCount = 0;

        for (const file of files) {
            const filePath = path.join(outputDir, file);
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) continue;

            // O ID da conversa é a primeira parte antes do "_"
            const conversationId = file.split('_')[0];

            if (idToDayMap.has(conversationId)) {
                const day = idToDayMap.get(conversationId);
                const dayFolderName = day.includes('-') ? day : `Dia_${day}`;
                const targetDir = path.join(outputDir, dayFolderName);

                if (!existsSync(targetDir)) {
                    await fs.mkdir(targetDir, { recursive: true });
                }

                const targetPath = path.join(targetDir, file);
                await fs.rename(filePath, targetPath);
                movedCount++;
            }
        }
        console.log(`✅ Organização concluída! ${movedCount} arquivos movidos para subpastas.`);
    } catch (error) {
        console.error('❌ Erro ao organizar arquivos:', error.message);
    }
}

async function runConversionScript(recordingsDir, targetFormat) {
    return new Promise((resolve, reject) => {
        console.log(`\n=== INICIANDO CONVERSÃO PARA ${targetFormat.toUpperCase()} ===`);
        
        const scriptPath = path.join(__dirname, 'convert.ps1');
        const ps = spawn('powershell.exe', [
            '-ExecutionPolicy', 'Bypass',
            '-NoProfile',
            '-File', scriptPath,
            '-targetDir', recordingsDir,
            '-targetFormat', targetFormat.toLowerCase()
        ]);

        let errorOutput = '';

        ps.stdout.on('data', (data) => {
            console.log(data.toString().trim());
        });

        ps.stderr.on('data', (data) => {
            const errorMessage = data.toString().trim();
            console.error(`ERRO no PowerShell: ${errorMessage}`);
            errorOutput += errorMessage + '\n';
        });

        ps.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Processo de conversão finalizado com sucesso.');
                resolve();
            } else {
                console.error(`❌ O processo de conversão terminou com o código de erro: ${code}`);
                reject(new Error(errorOutput || `Conversion script failed with code ${code}`));
            }
        });
    });
}

async function main() {
    console.log('🚀 GENESYS CLOUD RECORDING DOWNLOADER');
    console.log('=====================================\n');
    await selectRegion();
    await authenticate();
    
    const downloadMethod = await selectDownloadMethod();
    let conversationIds = [];
    let idToDayMap = new Map();
    
    if (downloadMethod === 'queue') {
        console.log('\n=== SELEÇÃO DE INTERVALO DE DATAS ===');
        const { startDate, endDate } = await selectDateRange();
        const queueId = await selectQueue();
        const result = await getConversationsWithRecordings(queueId, startDate, endDate);
        conversationIds = result.conversationIds;
        idToDayMap = result.idToDayMap;
    } else {
        console.log('\n=== LEITURA DE ARQUIVO DE IDs ===');
        const result = await getConversationIdsFromFile();
        conversationIds = result.conversationIds;
        idToDayMap = result.idToDayMap;
    }
    
    const formatId = await selectAudioFormat(); 
    
    if (conversationIds.length === 0) {
        console.log('⚠️ Nenhuma conversa encontrada.');
        return;
    }
    const recordings = await getRecordingsMetadata(conversationIds);
    if (recordings.length === 0) {
        console.log('⚠️ Nenhuma gravação disponível para download encontrada.');
        return;
    }
    
    const batchIds = await createBatchRequests(recordings);
    if(!batchIds || batchIds.length === 0) return;

    const batchResults = await checkBatchStatuses(batchIds);
    if(!batchResults || batchResults.length === 0) {
        console.log('⚠️ O lote não retornou resultados para download.');
        return;
    }
    
    const outputDir = await downloadRecordings(batchResults);

    try {
        if (outputDir && existsSync(outputDir) && (formatId === 'WAV' || formatId === 'MP3')) {
            await runConversionScript(outputDir, formatId);
        }
    } catch (error) {
        console.error('❌ Falha na etapa de conversão:', error.message);
    }

    // Pergunta final sobre organização
    if (idToDayMap.size > 0) {
        const confirmOrganize = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Deseja organizar as gravações em subpastas por dia/data?',
            initial: true
        });

        if (confirmOrganize.value) {
            await organizeFilesByDay(outputDir, idToDayMap);
        }
    }

    console.log('\nNenhuma tarefa pendente. Processo finalizado.');
}

main().catch(error => {
    console.error('❌ Erro fatal no processo principal:', error);
    process.exit(1);
});