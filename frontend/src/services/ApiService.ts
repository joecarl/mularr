export const apiService = {
  async getStatus() {
    const res = await fetch('/api/status');
    return res.json();
  },
  async getServers() {
    const res = await fetch('/api/servers');
    return res.json();
  },
  async getTransfers() {
    const res = await fetch('/api/transfers');
    return res.json();
  },
  async search(query: string, type: string) {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, type }),
    });
    return res.json();
  },
  async getSearchResults() {
    const res = await fetch('/api/search/results');
    return res.json();
  },
  async addDownload(link: string) {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link }),
    });
    return res.json();
  },
};
