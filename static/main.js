let currentEventSource = null;
let aiMessageDiv = null;
let finalAnswer = null;
let thoughtQuote = null;
let chatMessages = null;

function showErrorToast(message) {
    const toastEl = document.getElementById('errorToast');
    const toastBody = toastEl.querySelector('.toast-body');
    toastBody.textContent = message;

    const toast = new bootstrap.Toast(toastEl);
    toast.show();
}

function createChat() {
    const isLongThought = document.getElementById('longThoughtCheckbox').checked;
    const promptInput = document.getElementById('messageInput');
    const prompt = promptInput.value.trim();

    if (!prompt) {
        showErrorToast("Please enter a valid prompt");
        promptInput.focus();
        return;
    }

    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }

    fetch('/tasks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
    })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.detail || 'Request failed') });
            }
            return response.json();
        })
        .then(data => {
            if (!data.task_id) {
                throw new Error('Invalid task ID');
            }
            addMessage(prompt, 'user');
            setupSSE(data.task_id, isLongThought);
            promptInput.value = '';
        })
        .catch(error => {
            showErrorToast(error.message)
            console.error('Failed to create task:', error);
        });
}

function setupSSE(taskId, isLongThought) {
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 2000;
    let lastResultContent = '';

    function connect() {
        const eventSource = new EventSource(`/tasks/${taskId}/events`);
        currentEventSource = eventSource;

        const handleEvent = (event, type) => {
            try {
                const data = JSON.parse(event.data);
                if (!isLongThought) {
                    if (type === 'act') {
                        addMessage(data.result, 'ai')
                    }
                    return;
                }

                if (type === 'log' && data.result.indexOf('Executing step') > -1) {
                    createLongThought(data.result);
                } else if (type === 'act') {
                    finalAnswer.textContent = data.result
                } else {
                    const stepDiv = document.createElement('div');
                    stepDiv.className = 'thinking-message';
                    stepDiv.textContent = data.result;
                    thoughtQuote.querySelector('.quote-content').appendChild(stepDiv);
                }
            } catch (e) {
                console.error(`Error handling ${type} event:`, e);
            }
        };

        const eventTypes = ['think', 'tool', 'act', 'log', 'run', 'message'];
        eventTypes.forEach(type => {
            eventSource.addEventListener(type, (event) => handleEvent(event, type));
        });

        eventSource.addEventListener('complete', (event) => {
            try {
                const data = JSON.parse(event.data);
                lastResultContent = data.result || '';

                if (lastResultContent) {
                    // if (isLongThought) {
                    //     finalAnswer.textContent = lastResultContent
                    // } else {
                    //     addMessage(lastResultContent, 'ai')
                    // }
                    console.log(lastResultContent)
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
                eventSource.close();
                currentEventSource = null;
            } catch (e) {
                console.error('Error handling complete event:', e);
            }
        });

        eventSource.addEventListener('error', (event) => {
            try {
                console.error(event)
                const data = JSON.parse(event.data);
                showErrorToast(data.message)
                eventSource.close();
                currentEventSource = null;
            } catch (e) {
                console.error('Error handling failed:', e);
            }
        });

        eventSource.onerror = (err) => {
            if (eventSource.readyState === EventSource.CLOSED) return;

            console.error('SSE connection error:', err);
            eventSource.close();

            fetch(`/tasks/${taskId}`)
                .then(response => response.json())
                .then(task => {
                    if (task.status === 'completed' || task.status === 'failed') {
                        if (task.status === 'completed') {
                            // TODO
                        } else {
                            console.error(task)
                            showErrorToast(task.error)
                        }
                    } else if (retryCount < maxRetries) {
                        retryCount++;
                        showErrorToast(`Connection lost, retrying in ${retryDelay / 1000} seconds (${retryCount}/${maxRetries})`)
                        setTimeout(connect, retryDelay);
                    } else {
                        showErrorToast('Connection lost, please try refreshing the page')
                    }
                })
                .catch(error => {
                    console.error('Task status check failed:', error);
                    if (retryCount < maxRetries) {
                        retryCount++;
                        setTimeout(connect, retryDelay);
                    }
                });
        };
    }

    connect();
}

function loadHistory() {
    fetch('/tasks')
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`request failure: ${response.status} - ${text.substring(0, 100)}`);
                });
            }
            return response.json();
        })
        .then(tasks => {
            applyHistory(tasks)
        })
        .catch(error => {
            console.error('Failed to load history records:', error);
            showErrorToast(error.message)
        });
}

function applyHistory(tasks) {
    if (!tasks) return;
    const historyModal = new bootstrap.Modal(document.getElementById('historyModal'));
    const historyList = document.getElementById('historyList');

    historyList.innerHTML = '';

    if (tasks.length === 0) {
        historyList.innerHTML = '<li class="list-group-item text-muted">Record not found!</li>';
    } else {
        tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        tasks.forEach(item => {
            const title = item.prompt
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.innerHTML = `
                <div class="fw-bold">${title}</div>
                <small class="text-muted">${new Date(item.created_at).toLocaleString()}</small>
            `;

            li.addEventListener('click', function () {
                chatMessages.innerHTML = '';
                addMessage(item.prompt, 'user');
                item.steps.forEach(step => {
                    if (step.type === 'result') {
                        return;
                    }
                    if (step.type === 'log' && step.result.indexOf('Executing step') > -1) {
                        createLongThought(step.result);
                    } else if (step.type === 'act') {
                        finalAnswer.textContent = step.result
                    } else {
                        const stepDiv = document.createElement('div');
                        stepDiv.className = 'thinking-message';
                        stepDiv.textContent = step.result;
                        thoughtQuote.querySelector('.quote-content').appendChild(stepDiv);
                    }
                });

                historyModal.hide();
            });

            historyList.appendChild(li);
        });
    }

    historyModal.show();
}

function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add(sender + '-message');

    const iconDiv = document.createElement('div');
    iconDiv.className = 'message-icon';
    const icon = document.createElement('i');
    icon.className = sender === 'user' ? 'bi bi-person-fill' : 'bi bi-robot';
    iconDiv.appendChild(icon);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = text;

    if (sender === 'user') {
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(iconDiv);
    } else {
        messageDiv.appendChild(iconDiv);
        messageDiv.appendChild(contentDiv);
    }

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createLongThought(prompt) {
    aiMessageDiv = document.createElement('div');
    aiMessageDiv.className = 'message ai-message';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'message-icon';
    const icon = document.createElement('i');
    icon.className = 'bi bi-robot';
    iconDiv.appendChild(icon);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    thoughtQuote = document.createElement('div');
    thoughtQuote.className = 'thought-quote';
    thoughtQuote.innerHTML = `
        <div class="quote-header">
            <span>Thinking...</span>
            <span class="toggle-icon expanded"><i class="bi bi-chevron-down"></i></span>
        </div>
        <div class="quote-content">
            <div class="thinking-message">${prompt}</div>
        </div>
    `;

    finalAnswer = document.createElement('div');
    finalAnswer.className = 'ai-final-answer';

    contentDiv.appendChild(thoughtQuote);
    contentDiv.appendChild(finalAnswer);

    aiMessageDiv.appendChild(iconDiv);
    aiMessageDiv.appendChild(contentDiv);

    chatMessages.appendChild(aiMessageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    thoughtQuote.addEventListener('click', function (e) {
        if (e.target.closest('.quote-header')) {
            const isCollapsing = !this.classList.contains('collapsed');
            this.classList.toggle('collapsed');
            const icon = this.querySelector('.toggle-icon');
            icon.innerHTML = isCollapsing ? '<i class="bi bi-chevron-up"></i>' : '<i class="bi bi-chevron-down"></i>';
        }
    });
}

function getCustomCss() {
    return `
        <style>
            .ai-table {
                border-collapse: collapse;
                width: 100%;
                margin: 10px 0;
            }
            .ai-table th {
                background-color: #343a40;
                color: white;
                padding: 8px 12px;
                text-align: left;
            }
            .ai-table td {
                padding: 8px 12px;
                border: 1px solid #dee2e6;
            }
            .ai-table tr:nth-child(even) {
                background-color: #f8f9fa;
            }
            .ai-table tr:hover {
                background-color: #e9ecef;
            }
            .ai-table-container {
                margin: 15px 0;
            }
        </style>
    `;
}

document.addEventListener('DOMContentLoaded', function () {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const historyBtn = document.getElementById('btn-history');
    const chatBtn = document.getElementById('btn-chat');
    chatMessages = document.getElementById('chatMessages');

    const tooltipSend = new bootstrap.Tooltip(sendButton);
    const tooltipHist = new bootstrap.Tooltip(historyBtn);
    const tooltipChat = new bootstrap.Tooltip(chatBtn);

    if (!messageInput || !sendButton || !chatMessages) {
        console.error('Required elements not found!');
        return;
    }

    messageInput.addEventListener('input', function () {
        sendButton.disabled = this.value.trim() === '';
    });

    const promptShortcuts = document.querySelectorAll('.prompt-shortcut');

    function sendMessage() {
        const message = messageInput.value.trim();
        if (message && !sendButton.disabled) {
            sendButton.disabled = true;
            createChat();
        }
    }

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    promptShortcuts.forEach(shortcut => {
        shortcut.addEventListener('click', function () {
            messageInput.value = this.textContent;
            messageInput.focus();
            sendButton.disabled = messageInput.value.trim() === '';
        });
    });

    document.querySelector('.btn-chat').addEventListener('click', function () {
        chatMessages.innerHTML = '';
    });

    document.querySelector('.btn-history').addEventListener('click', function () {
        loadHistory();
    });
});
