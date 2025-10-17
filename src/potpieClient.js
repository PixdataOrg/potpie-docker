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
    async waitForParsingComplete(projectId, maxWaitTime = 300000) { // 5 minutes max
        const startTime = Date.now();
        const pollInterval = 5000; // 5 seconds

        while (Date.now() - startTime < maxWaitTime) {
            const statusResult = await this.getParsingStatus(projectId);

            if (!statusResult.success) {
                return statusResult;
            }

            const status = statusResult.data.status;
            console.log(`Parsing status for project ${projectId}: ${status}`);

            if (status === 'ready') {
                return {
                    success: true,
                    data: statusResult.data
                };
            }

            if (status === 'failed' || status === 'error') {
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

        return {
            success: false,
            error: {
                message: 'Parsing timeout - exceeded maximum wait time',
                status: 408,
                details: { projectId, maxWaitTime }
            }
        };
    }

    // Create conversation with agent
    async createConversation(projectId, agentType = 'codebase_qna_agent') {
        try {
            const response = await this.client.post('/api/v2/conversations', {
                project_ids: [projectId],
                agent_ids: [agentType]
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

    async getAgentByName(name) {
        const res = await this.client.get('/api/v2/custom-agents/agents');
        if (!res?.data) return null;
        return res.data.find(a => a.name === name);
    }

    // Verifica se l'agente esiste, altrimenti lo crea
    async ensureCustomAgent(agentConfig) {
        const existing = await this.getAgentByName(agentConfig.name);
        if (existing) {
            console.log(`ℹ️ [POTPIE] Found existing agent: ${agentConfig.name}`);
            return existing;
        }

        console.log(`🆕 [POTPIE] Creating new agent: ${agentConfig.name}`);
        const created = await this.createCustomAgent(agentConfig);
        return created.data;
    }

    async createCustomAgent(agentConfig) {
        return this.client.post('/api/v2/custom-agents/agents', agentConfig);
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
