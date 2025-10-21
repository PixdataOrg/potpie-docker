const { Worker } = require('bullmq');
const { getBullMQConnection } = require('./redisConfig');
const PotpieClient = require('./potpieClient');

/**
 * BullMQ Worker for processing repository analysis jobs
 */
class AnalysisWorker {
  constructor(io) {
    this.io = io;
    this.potpieClient = new PotpieClient(process.env.POTPIE_API_KEY);
    this.queueName = process.env.QUEUE_NAME || 'potpie-analysis';
    this.maxConcurrency = parseInt(process.env.MAX_CONCURRENT_JOBS) || 5;
    this.maxRetries = parseInt(process.env.MAX_RETRIES) || 3;

    console.log('CUSTOM_AGENT_ID: ', process.env.CUSTOM_AGENT_ID);
    this.worker = null;
  }

  /**
   * Start the worker
   */
  start() {
    console.log(`🔧 [WORKER] Starting worker for queue: ${this.queueName}`);
    
    const connection = getBullMQConnection();
    console.log(`🔧 [WORKER] Connection config:`, JSON.stringify(connection, null, 2));
    
    this.worker = new Worker(
      this.queueName,
      this.processJob.bind(this),
      {
        connection: connection.connection,
        concurrency: this.maxConcurrency,
        removeOnComplete: 10, // Keep last 10 completed jobs
        removeOnFail: 50,     // Keep last 50 failed jobs
      }
    );
    
    console.log(`🔧 [WORKER] Worker created for queue: ${this.queueName}`);
    console.log(`🔧 [WORKER] ProcessJob function bound:`, typeof this.processJob === 'function');

    // Worker event handlers
    this.worker.on('ready', () => {
      console.log(`🔧 [WORKER] Analysis worker started (concurrency: ${this.maxConcurrency})`);
      console.log(`🔧 [WORKER] Worker is ready and listening for jobs on queue: ${this.queueName}`);
    });

    this.worker.on('error', (error) => {
      console.error('❌ [WORKER] Worker error:', error);
    });

    this.worker.on('failed', (job, error) => {
      console.error(`❌ [WORKER] Job ${job.id} failed:`, error.message);
      this.emitJobUpdate(job.data.project_id, 'failed', `Job failed: ${error.message}`);
    });

    this.worker.on('completed', (job) => {
      console.log(`✅ [WORKER] Job ${job.id} completed successfully`);
    });

    this.worker.on('active', (job) => {
      console.log(`🔄 [WORKER] Job ${job.id} is now active and being processed`);
    });

    this.worker.on('stalled', (jobId) => {
      console.warn(`⚠️ [WORKER] Job ${jobId} stalled`);
    });

    this.worker.on('progress', (job, progress) => {
      console.log(`📊 [WORKER] Job ${job.id} progress: ${progress}%`);
    });

    return this.worker;
  }

  /**
   * Stop the worker
   */
  async stop() {
    if (this.worker) {
      await this.worker.close();
      console.log('🔧 Analysis worker stopped');
    }
  }

  /**
   * Process a single analysis job
   */
  async processJob(job) {
      const { project_id, repo, branch, question, github_token } = job.data;
      const room = `project_${project_id}`;

      try {
          console.log(`🔄 [WORKER] Processing job ${job.id} for project ${project_id}`);
          this.emitJobUpdate(project_id, 'parsing', 'Repository parsing in progress...');

          // 🧩 Step 1: Wait for parsing to complete
          console.log(`🔄 [WORKER] Waiting for parsing to complete...`);
          const parsingResult = await this.potpieClient.waitForParsingComplete(project_id, 300000, this.io, true);

          if (!parsingResult.success) {
              throw new Error(`Parsing failed: ${parsingResult.error.details}`);
          }

          this.emitJobUpdate(project_id, 'ready', 'Parsing completed. Starting knowledge extraction...');

          // 🧠 Step 3: Send message to agent to perform analysis
          const userPrompt = `${question}.
              Answer only with the result formatted in a JSON structure like following:        
              {
                "snippets": [{ "node_id": "...", "file_path": "...", "code": "...", "tags": [...], "description": "...", "line_start": 0, "line_end": 0 }],
                "snippets_count": <number>,
                "analysis_response": {...},
                "metadata": {
                  "parsed_at": "<ISO date>",
                  "total_nodes_found": <number>,
                  "processed_nodes": <number>,
                  "repo": "${repo}",
                  "branch": "${branch}"
                }
              }
            `;

          console.log(`🔄 [WORKER] Sending analysis request to agent...`);
          const response = await this.potpieClient.sendMessage(project_id, userPrompt);
          console.log(response);
          if (!success) throw new Error(`Failed to create conversation for project ${project_id}`);

          // 🧾 Step 4: Process agent output
          const agentOutput = response?.message || {};
          console.log(`✅ [WORKER] Agent output received:`, JSON.stringify(agentOutput, null, 2));

          // Fallbacks per compatibilità
          const snippets = agentOutput.snippets || [];
          const analysisResponse = agentOutput.analysis_response || {};
          const totalNodesFound = agentOutput.metadata?.total_nodes_found || snippets.length;

          const vectorDbData = {
              project_id,
              repo,
              branch,
              question,
              parsing_status: parsingResult.data.status,
              snippets,
              snippets_count: snippets.length,
              analysis_response: analysisResponse,
              metadata: {
                  ...agentOutput.metadata,
                  parsed_at: new Date().toISOString(),
                  total_nodes_found: totalNodesFound,
                  processed_nodes: snippets.length,
                  has_github_token: !!github_token,
                  processing_time_ms: Date.now() - new Date(job.timestamp).getTime(),
                  job_id: job.id
              }
          };

          console.log(`✅ [WORKER] Analysis completed for ${project_id}. Extracted ${snippets.length} snippets.`);

          // Step 5: Emit final result
          this.emitJobUpdate(project_id, 'finished', 'Job finished');

          this.io.to(room).emit('analysis_complete', {
              project_id,
              status: 'finished',
              data: vectorDbData,
              message: 'Analysis completed successfully. Data ready for vector DB.',
              timestamp: new Date().toISOString()
          });

          return vectorDbData;

      } catch (error) {
          console.error(`❌ [WORKER] Error processing analysis for project ${project_id}:`, error);

          this.io.to(room).emit('analysis_error', {
              project_id,
              status: 'failed',
              error: 'Analysis processing failed',
              message: error.message,
              timestamp: new Date().toISOString()
          });

          throw error;
      }
  }

  /**
   * Emit job status update via WebSocket
   */
  emitJobUpdate(projectId, status, message) {
    const room = `project_${projectId}`;
    this.io.to(room).emit('status_update', {
      project_id: projectId,
      status: status,
      message: message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = AnalysisWorker;
