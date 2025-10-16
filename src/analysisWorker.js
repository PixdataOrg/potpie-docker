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
      console.log(`🔄 [WORKER] Job data:`, { project_id, repo, branch, question: question?.substring(0, 100) });

      // Step 1: Emit parsing status
      this.emitJobUpdate(project_id, 'parsing', 'Repository parsing in progress...');

      // Step 2: Wait for parsing to complete
      console.log(`🔄 [WORKER] Waiting for parsing to complete for project ${project_id}...`);
      const parsingResult = await this.potpieClient.waitForParsingComplete(project_id);
      
      console.log(`🔄 [WORKER] Parsing result:`, JSON.stringify(parsingResult, null, 2));
      
      if (!parsingResult.success) {
        throw new Error(`Parsing failed: ${parsingResult.error.message}`);
      }

      // Step 3: Update status to ready
      this.emitJobUpdate(project_id, 'ready', 'Parsing completed, starting conversations...');

      // Step 4: Start conversation processing
      this.emitJobUpdate(project_id, 'processing_conversations', 'Extracting knowledge graph and running conversations...');

      console.log(`Starting conversation processing for project ${project_id}...`);

      // Create conversation with codebase QnA agent
      console.log(`🔄 [WORKER] Creating conversation for project ${project_id}...`);
      const conversationResult = await this.potpieClient.createConversation(project_id, 'codebase_qna_agent');
      
      console.log(`🔄 [WORKER] Conversation result:`, JSON.stringify(conversationResult, null, 2));
      
      if (!conversationResult.success) {
        console.warn(`⚠️ [WORKER] Failed to create conversation for project ${project_id}, proceeding with knowledge graph queries`);
      }

      // Extract data using knowledge graph tools
      const commonTags = ['function', 'class', 'module', 'component', 'service', 'controller', 'model'];
      console.log(`🔄 [WORKER] Requesting nodes from tags:`, commonTags);
      const nodesResult = await this.potpieClient.getNodesFromTags(project_id, commonTags);
      
      console.log(`🔄 [WORKER] Nodes result:`, JSON.stringify(nodesResult, null, 2));
      
      let snippets = [];
      
      if (nodesResult.success && nodesResult.data.nodes) {
        console.log(`🔄 [WORKER] Found ${nodesResult.data.nodes.length} nodes for project ${project_id}`);
        
        // Get code for each node (limit to first 50 to avoid timeout)
        const nodesToProcess = nodesResult.data.nodes.slice(0, 50);
        
        for (const node of nodesToProcess) {
          const codeResult = await this.potpieClient.getCodeFromNodeId(project_id, node.id);
          
          if (codeResult.success) {
            snippets.push({
              node_id: node.id,
              file_path: node.file_path || 'unknown',
              code: codeResult.data.code || '',
              tags: node.tags || [],
              description: node.description || '',
              line_start: node.line_start || 0,
              line_end: node.line_end || 0
            });
          }
        }
      }

      // Ask knowledge graph query about the specific question
      const queryResult = await this.potpieClient.askKnowledgeGraphQueries(project_id, question);
      
      let analysisResponse = null;
      if (queryResult.success) {
        analysisResponse = queryResult.data;
      }

      // Step 5: Compose final response for vector DB
      const vectorDbData = {
        project_id: project_id,
        repo: repo,
        branch: branch,
        question: question,
        parsing_status: parsingResult.data.status,
        snippets: snippets,
        snippets_count: snippets.length,
        analysis_response: analysisResponse,
        metadata: {
          parsed_at: new Date().toISOString(),
          total_nodes_found: nodesResult.success ? nodesResult.data.nodes?.length || 0 : 0,
          processed_nodes: snippets.length,
          has_github_token: !!github_token,
          processing_time_ms: Date.now() - new Date(job.timestamp).getTime(),
          job_id: job.id
        }
      };

      console.log(`Analysis completed for project ${project_id}. Extracted ${snippets.length} code snippets.`);

      // Step 6: Emit final result
      this.io.to(room).emit('analysis_complete', {
        project_id: project_id,
        status: 'finished',
        data: vectorDbData,
        message: 'Analysis completed successfully. Data ready for vector DB.',
        timestamp: new Date().toISOString()
      });

      // Return the result (BullMQ will store this as job result)
      return vectorDbData;

    } catch (error) {
      console.error(`Error processing analysis for project ${project_id}:`, error);
      
      // Emit error via WebSocket
      this.io.to(room).emit('analysis_error', {
        project_id: project_id,
        status: 'failed',
        error: 'Analysis processing failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
      
      // Re-throw error so BullMQ can handle retries
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
