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
        console.log(`✅ Encontradas ${conversationIds.length} conversas`);
        return conversationIds;
    } catch (error) {
        console.error('❌ Erro ao buscar conversas:', error.message);
        return [];
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

async function createBatchRequest(recordings) {
    console.log('\n=== ADICIONANDO GRAVAÇÕES AO LOTE PARA DOWNLOAD ===');
    const batchRequest = {
        batchDownloadRequestList: recordings.map(rec => ({
            conversationId: rec.conversationId,
            recordingId: rec.id
        })),
        formatId: 'OGG'
    };

    try {
        const batchResponse = await recordingApi.postRecordingBatchrequests(batchRequest);
        recordings.forEach(rec => {
            console.log(`✅ Adicionado ao lote: ${rec.conversationId}_${rec.id}`);
        });
        return batchResponse.id;
    } catch (error) {
        console.error('❌ Erro ao criar lote:', error.message);
        process.exit(1);
    }
}

async function checkBatchStatus(batchId, maxRetries = 60, retryInterval = 10000) {
    console.log('\n=== VERIFICANDO STATUS DO LOTE DE DOWNLOAD ===');
    let retries = 0;
    while (retries < maxRetries) {
        try {
            const status = await recordingApi.getRecordingBatchrequest(batchId);
            const completed = (status.results || []).filter(r => r.resultUrl || r.errorMsg).length;
            console.log(`📊 Status do lote: ${completed}/${status.expectedResultCount}`);
            if (completed === status.expectedResultCount) {
                console.log('✅ Lote de download processado!');
                return status.results;
            }
            await new Promise(resolve => setTimeout(resolve, retryInterval));
            retries++;
        } catch (error) {
            console.error('❌ Erro ao verificar status do lote:', error.message);
            await new Promise(resolve => setTimeout(resolve, retryInterval));
            retries++;
        }
    }
    console.error('❌ Tempo limite excedido para o lote');
    process.exit(1);
}

async function downloadRecordings(batchResults) {
    console.log('\n=== PROCESSANDO DOWNLOADS ===');
    const outputDir = path.join(__dirname, 'Recordings');
    await fs.mkdir(outputDir, { recursive: true });
    const successfulDownloads = [];

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
        }
    }
    
    (batchResults || []).filter(r => r.errorMsg).forEach(err => {
        console.warn(`⚠️ Erro no processamento da gravação ${err.conversationId}_${err.recordingId}: ${err.errorMsg}`);
    });

    console.log(`\n🎉 Processo de download concluído!`);
    console.log(`📊 Total de gravações baixadas: ${successfulDownloads.length}`);
    console.log(`📁 Arquivos salvos em: ${outputDir}`);

    return outputDir;
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
    console.log('\n=== SELEÇÃO DE INTERVALO DE DATAS ===');
    const { startDate, endDate } = await selectDateRange();
    const queueId = await selectQueue();
    const formatId = await selectAudioFormat(); 
    
    const conversationIds = await getConversationsWithRecordings(queueId, startDate, endDate);
    if (conversationIds.length === 0) {
        console.log('⚠️ Nenhuma conversa encontrada.');
        return;
    }
    const recordings = await getRecordingsMetadata(conversationIds);
    if (recordings.length === 0) {
        console.log('⚠️ Nenhuma gravação disponível para download encontrada.');
        return;
    }
    
    const batchId = await createBatchRequest(recordings);
    if(!batchId) return;

    const batchResults = await checkBatchStatus(batchId);
    if(!batchResults || batchResults.length === 0) {
        console.log('⚠️ O lote não retornou resultados para download.');
        return;
    }
    
    const outputDir = await downloadRecordings(batchResults);

    try {
        if (outputDir && existsSync(outputDir) && (formatId === 'WAV' || formatId === 'MP3')) {
            await runConversionScript(outputDir, formatId);
        } else {
            console.log('\nNenhuma conversão necessária. Processo finalizado.');
        }
    } catch (error) {
        console.error('❌ Falha na etapa de conversão:', error.message);
    }
}

main().catch(error => {
    console.error('❌ Erro fatal no processo principal:', error);
    process.exit(1);
});