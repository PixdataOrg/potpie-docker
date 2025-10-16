require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { Queue } = require('bullmq');
const { getBullMQConnection, testRedisConnection } = require('./redisConfig');
const AnalysisWorker = require('./analysisWorker');
const PotpieClient = require('./potpieClient');

// Prometheus metrics
const promClient = require('prom-client');
const register = new promClient.Registry();

// Custom metrics
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const queueJobsTotal = new promClient.Counter({
  name: 'queue_jobs_total',
  help: 'Total number of queue jobs',
  labelNames: ['status'],
  registers: [register]
});

const queueJobDuration = new promClient.Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Duration of queue jobs in seconds',
  buckets: [1, 5, 10, 30, 60, 300, 600],
  registers: [register]
});

const activeConnections = new promClient.Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
  registers: [register]
});

// Default metrics
promClient.collectDefaultMetrics({ register });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 8080;

// Initialize Potpie client
const potpieClient = new PotpieClient(process.env.POTPIE_API_KEY);

// Initialize BullMQ Queue
const queueName = process.env.QUEUE_NAME || 'potpie-analysis';
const maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
let analysisQueue;
let analysisWorker;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Coderide Potpie Service (BullMQ)',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    queue_name: queueName,
    max_retries: maxRetries
  });
});

// Health check with Potpie API and Redis validation
app.get('/health', async (req, res) => {
  try {
    const potpieHealth = await potpieClient.healthCheck();
    const redisHealth = await testRedisConnection();
    
    let queueStats = null;
    if (analysisQueue) {
      try {
        queueStats = {
          waiting: await analysisQueue.getWaiting(),
          active: await analysisQueue.getActive(),
          completed: await analysisQueue.getCompleted(),
          failed: await analysisQueue.getFailed()
        };
      } catch (error) {
        console.warn('Could not get queue stats:', error.message);
      }
    }
    
    res.json({
      status: 'ok',
      service: 'Coderide Potpie Service (BullMQ)',
      potpie_api: potpieHealth.success ? 'connected' : 'disconnected',
      redis: redisHealth ? 'connected' : 'disconnected',
      queue: analysisQueue ? 'initialized' : 'not_initialized',
      worker: analysisWorker ? 'running' : 'not_running',
      queue_stats: queueStats,
      websocket_connections: io.engine.clientsCount,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'Coderide Potpie Service (BullMQ)',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Repository analysis endpoint - Uses BullMQ Queue
app.post('/analyze', async (req, res) => {
  try {
    const { repo, branch, question, github_token } = req.body;

    // Validate required parameters
    if (!repo) {
      return res.status(400).json({
        error: 'Missing required parameter: repo',
        example: {
          repo: 'org/repository-name',
          branch: 'main',
          question: 'Explain the authentication module',
          github_token: 'ghp_xxxxxxxxxxxxxxxxxxxx'
        }
      });
    }

    if (!analysisQueue) {
      return res.status(503).json({
        error: 'Analysis queue not initialized',
        message: 'Service is starting up, please try again in a moment',
        timestamp: new Date().toISOString()
      });
    }

    const repoName = repo;
    const branchName = branch || 'main';
    const analysisQuestion = question || 'Explain the repository architecture';

    console.log(`Starting analysis for repository: ${repoName}, branch: ${branchName}`);

    // Step 1: Initiate repository parsing with Potpie
    const parseResult = await potpieClient.parseRepository(repoName, branchName, github_token);
    
    if (!parseResult.success) {
      return res.status(parseResult.error.status || 500).json({
        success: false,
        error: 'Failed to initiate repository parsing',
        details: parseResult.error,
        timestamp: new Date().toISOString()
      });
    }

    const projectId = parseResult.data.project_id;
    console.log(`Repository parsing initiated. Project ID: ${projectId}`);

    // Step 2: Add job to BullMQ queue
    const jobData = {
      project_id: projectId,
      repo: repoName,
      branch: branchName,
      question: analysisQuestion,
      github_token: github_token
    };

    const job = await analysisQueue.add(
      'analyze-repository',
      jobData,
      {
        attempts: maxRetries,
        backoff: {
          type: 'exponential',
          delay: 5000, // Start with 5 seconds
        },
        removeOnComplete: 10,
        removeOnFail: 50,
        jobId: projectId // Use project_id as job ID for easy tracking
      }
    );

    console.log(`Job ${job.id} added to queue for project ${projectId}`);

    // Step 3: Emit initial queued status
    const room = `project_${projectId}`;
    io.to(room).emit('status_update', {
      project_id: projectId,
      status: 'queued',
      message: 'Analysis job queued and will start processing soon...',
      job_id: job.id,
      timestamp: new Date().toISOString()
    });

    // Return immediately with project_id and job info
    res.json({
      success: true,
      project_id: projectId,
      job_id: job.id,
      status: 'queued',
      message: 'Repository analysis queued. Connect to Socket.IO for real-time updates.',
      socket_io_endpoint: "http://18.198.147.24:31080",
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Analysis endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during analysis initiation',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Project status endpoint
app.get('/status/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({
        error: 'Missing project ID parameter',
        timestamp: new Date().toISOString()
      });
    }

    if (!analysisQueue) {
      return res.status(503).json({
        error: 'Analysis queue not initialized',
        timestamp: new Date().toISOString()
      });
    }

    // Check job status in BullMQ
    const job = await analysisQueue.getJob(projectId);
    
    if (job) {
      const jobState = await job.getState();
      const progress = job.progress || 0;
      
      let status = 'unknown';
      switch (jobState) {
        case 'waiting':
          status = 'queued';
          break;
        case 'active':
          status = 'parsing'; // Default to parsing when active
          break;
        case 'completed':
          status = 'finished';
          break;
        case 'failed':
          status = 'failed';
          break;
        default:
          status = jobState;
      }

      res.json({
        success: true,
        project_id: projectId,
        job_id: job.id,
        status: status,
        progress: progress,
        attempts: job.attemptsMade,
        max_attempts: job.opts.attempts,
        details: {
          created_at: new Date(job.timestamp).toISOString(),
          processed_at: job.processedOn ? new Date(job.processedOn).toISOString() : null,
          finished_at: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
          failed_reason: job.failedReason || null
        },
        timestamp: new Date().toISOString()
      });
    } else {
      // Job not found in queue, check with Potpie directly
      const statusResult = await potpieClient.getParsingStatus(projectId);

      if (statusResult.success) {
        res.json({
          success: true,
          project_id: projectId,
          status: statusResult.data.status,
          source: 'potpie_direct',
          details: statusResult.data,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          success: false,
          project_id: projectId,
          error: 'Project not found in queue or Potpie',
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    console.error('Status endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Queue statistics endpoint
app.get('/queue/stats', async (req, res) => {
  try {
    if (!analysisQueue) {
      return res.status(503).json({
        error: 'Analysis queue not initialized',
        timestamp: new Date().toISOString()
      });
    }

    const waiting = await analysisQueue.getWaiting();
    const active = await analysisQueue.getActive();
    const completed = await analysisQueue.getCompleted();
    const failed = await analysisQueue.getFailed();

    // Update Prometheus metrics
    queueJobsTotal.labels('waiting').inc(waiting.length);
    queueJobsTotal.labels('active').inc(active.length);
    queueJobsTotal.labels('completed').inc(completed.length);
    queueJobsTotal.labels('failed').inc(failed.length);

    res.json({
      queue_name: queueName,
      stats: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        total: waiting.length + active.length + completed.length + failed.length
      },
      worker_status: analysisWorker ? 'running' : 'stopped',
      max_concurrency: parseInt(process.env.MAX_CONCURRENT_JOBS) || 5,
      max_retries: maxRetries,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Queue stats error:', error);
    res.status(500).json({
      error: 'Failed to get queue statistics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    // Update WebSocket connections metric
    activeConnections.set(io.engine.clientsCount);

    // Update queue metrics if available
    if (analysisQueue) {
      try {
        const waiting = await analysisQueue.getWaiting();
        const active = await analysisQueue.getActive();
        const completed = await analysisQueue.getCompleted();
        const failed = await analysisQueue.getFailed();

        // Set current queue state
        register.getSingleMetric('queue_jobs_waiting')?.set(waiting.length);
        register.getSingleMetric('queue_jobs_active')?.set(active.length);
        register.getSingleMetric('queue_jobs_completed')?.set(completed.length);
        register.getSingleMetric('queue_jobs_failed')?.set(failed.length);
      } catch (error) {
        console.warn('Could not update queue metrics:', error.message);
      }
    }

    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    console.error('Metrics endpoint error:', error);
    res.status(500).end('Error generating metrics');
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`WebSocket client connected: ${socket.id}`);

  // Join project-specific room
  socket.on('join_project', async (projectId) => {
    const room = `project_${projectId}`;
    socket.join(room);
    console.log(`Client ${socket.id} joined room ${room}`);
    
    // Send current job status if exists
    if (analysisQueue) {
      try {
        const job = await analysisQueue.getJob(projectId);
        if (job) {
          const jobState = await job.getState();
          let status = jobState === 'waiting' ? 'queued' : 
                      jobState === 'active' ? 'parsing' :
                      jobState === 'completed' ? 'finished' :
                      jobState === 'failed' ? 'failed' : jobState;

          socket.emit('status_update', {
            project_id: projectId,
            status: status,
            message: getStatusMessage(status),
            job_id: job.id,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.warn(`Could not get job status for project ${projectId}:`, error.message);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`WebSocket client disconnected: ${socket.id}`);
  });
});

// Helper function to get status messages
function getStatusMessage(status) {
  const messages = {
    'queued': 'Analysis job queued and will start processing soon...',
    'parsing': 'Repository parsing in progress...',
    'ready': 'Parsing completed, starting conversations...',
    'processing_conversations': 'Extracting knowledge graph and running conversations...',
    'finished': 'Analysis completed successfully. Data ready for vector DB.',
    'failed': 'Analysis failed. Check error details.'
  };
  return messages[status] || 'Unknown status';
}

// Initialize BullMQ Queue and Worker
async function initializeQueue() {
  try {
    console.log('🔄 Initializing BullMQ queue and worker...');
    
    // Test Redis connection first
    const redisConnected = await testRedisConnection();
    if (!redisConnected) {
      throw new Error('Redis connection failed');
    }

    // Initialize queue
    const connection = getBullMQConnection();
    analysisQueue = new Queue(queueName, connection);
    
    console.log(`✅ BullMQ queue "${queueName}" initialized`);

    // Initialize and start worker
    analysisWorker = new AnalysisWorker(io);
    analysisWorker.start();

    console.log('✅ BullMQ initialization complete');
  } catch (error) {
    console.error('❌ Failed to initialize BullMQ:', error.message);
    process.exit(1);
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    available_endpoints: {
      'GET /': 'Service health check',
      'GET /health': 'Detailed health check with queue status',
      'POST /analyze': 'Start asynchronous repository analysis (BullMQ)',
      'GET /status/:projectId': 'Check analysis status',
      'GET /queue/stats': 'Queue statistics and monitoring',
      'WebSocket /': 'Real-time analysis updates (use join_project event)'
    },
    timestamp: new Date().toISOString()
  });
});

// Start server
async function startServer() {
  try {
    // Initialize BullMQ first
    await initializeQueue();

    // Start HTTP server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Coderide Potpie Service (BullMQ) running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/`);
      console.log(`🔍 Analysis endpoint: http://localhost:${PORT}/analyze`);
      console.log(`📈 Queue stats: http://localhost:${PORT}/queue/stats`);
      console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/`);
      
      if (!process.env.POTPIE_API_KEY) {
        console.warn('⚠️  WARNING: POTPIE_API_KEY environment variable not set!');
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown() {
  console.log('🔄 Starting graceful shutdown...');
  
  try {
    // Stop worker first
    if (analysisWorker) {
      await analysisWorker.stop();
    }

    // Close queue
    if (analysisQueue) {
      await analysisQueue.close();
      console.log('✅ BullMQ queue closed');
    }

    // Close WebSocket server
    io.close();
    console.log('✅ WebSocket server closed');

    // Close HTTP server
    server.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start the server
startServer();
