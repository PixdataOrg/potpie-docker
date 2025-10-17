const axios = require('axios');

class PotpieClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://production-api.potpie.ai/';

        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'x-api-key': this.apiKey,
                'Content-Type': 'application/json',
            },
            timeout: 60000, // 60 seconds timeout for parsing operations
        });
    }

    // Parse repository - starts the parsing process
    async parseRepository(repoName, branchName, githubToken) {
        try {
            const payload = {
                repo_name: repoName,
                branch_name: branchName
            };

            // Add GitHub token if provided (for private repos)
            if (githubToken) {
                payload.github_token = githubToken;
            }

            const response = await this.client.post('/api/v2/parse', payload);

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error('Potpie Parse API Error:', error.response?.data || error.message);

            return {
                success: false,
                error: {
                    message: error.response?.data?.message || error.message,
                    status: error.response?.status || 500,
                    details: error.response?.data || null
                }
            };
        }
    }

    // Check parsing status
    async getParsingStatus(projectId) {
        try {
            const response = await this.client.get(`/api/v2/parsing-status/${projectId}`);

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error('Potpie Parsing Status Error:', error.response?.data || error.message);

            return {
                success: false,
                error: {
                    message: error.response?.data?.message || error.message,
                    status: error.response?.status || 500,
                    details: error.response?.data || null
                }
            };
        }
    }

    // Wait for parsing to complete
    async waitForParsingComplete(projectId, maxWaitTime = 300000, io = null, emitUpdates = false) { // 5 minutes max
        const startTime = Date.now();
        const pollInterval = 5000; // 5 seconds
        const room = `project_${projectId}`;

        // Helper function to emit updates
        const emitUpdate = (status, message) => {
            if (io && emitUpdates) {
                io.to(room).emit('parsing_update', {
                    project_id: projectId,
                    status: status,
                    message: message,
                    timestamp: new Date().toISOString()
                });
            }
        };

        // Emit initial status
        emitUpdate('parsing', 'Starting to monitor parsing progress...');

        while (Date.now() - startTime < maxWaitTime) {
            const statusResult = await this.getParsingStatus(projectId);

            if (!statusResult.success) {
                emitUpdate('error', `Failed to get parsing status: ${statusResult.error.message}`);
                return statusResult;
            }

            const status = statusResult.data.status;
            console.log(`Parsing status for project ${projectId}: ${status}`);

            // Emit progress update
            const progressMessage = this.getParsingStatusMessage(status);
            emitUpdate(status, progressMessage);

            if (status === 'ready') {
                emitUpdate('ready', 'Repository parsing completed successfully!');
                return {
                    success: true,
                    data: statusResult.data
                };
            }

            if (status === 'failed' || status === 'error') {
                emitUpdate('failed', `Parsing failed with status: ${status}`);
                return {
                    success: false,
                    error: {
                        message: `Parsing failed with status: ${status}`,
                        status: 500,
                        details: statusResult.data
                    }
                };
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        emitUpdate('timeout', 'Parsing timeout - exceeded maximum wait time');
        return {
            success: false,
            error: {
                message: 'Parsing timeout - exceeded maximum wait time',
                status: 408,
                details: { projectId, maxWaitTime }
            }
        };
    }

    // Helper method to get user-friendly status messages
    getParsingStatusMessage(status) {
        const messages = {
            'queued': 'Repository parsing is queued and waiting to start...',
            'parsing': 'Repository parsing is in progress...',
            'processing': 'Processing repository files and structure...',
            'indexing': 'Building code index and knowledge graph...',
            'ready': 'Repository parsing completed successfully!',
            'failed': 'Repository parsing failed',
            'error': 'An error occurred during parsing',
            'timeout': 'Parsing operation timed out'
        };
        return messages[status] || `Parsing status: ${status}`;
    }

    // Create conversation with agent
    async createConversation(projectId) {
        try {
            const response = await this.client.post('/api/v2/conversations', {
                project_ids: [projectId],
                agent_ids: [process.env.CUSTOM_AGENT_ID]
            });

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error('Potpie Create Conversation Error:', error.response?.data || error.message);

            return {
                success: false,
                error: {
                    message: error.response?.data?.message || error.message,
                    status: error.response?.status || 500,
                    details: error.response?.data || null
                }
            };
        }
    }

    // Send message to conversation
    async sendMessage(conversationId, message) {
        try {
            const response = await this.client.post(`/api/v2/conversations/${conversationId}/messages`, {
                message: message
            });

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error('Potpie Send Message Error:', error.response?.data || error.message);

            return {
                success: false,
                error: {
                    message: error.response?.data?.message || error.message,
                    status: error.response?.status || 500,
                    details: error.response?.data || null
                }
            };
        }
    }

    // Legacy health check
    async healthCheck() {
        try {
            const response = await this.client.get('/health');
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            return {
                success: false,
                error: {
                    message: error.response?.data?.message || error.message,
                    status: error.response?.status || 500
                }
            };
        }
    }
}

module.exports = PotpieClient;
