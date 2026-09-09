import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Search, Users } from 'lucide-react';

export default function ChatCustomersPage() {
  const [data, setData] = useState({ total: 0, customers: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke('listChatCustomers', {});
        setData(res.data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = data.customers.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (c.name || '').toLowerCase().includes(s) || (c.phone || '').includes(s);
  });

  const downloadCSV = () => {
    const rows = [['Nome', 'Telefone', 'Unidade']];
    data.customers.forEach(c => rows.push([c.name, c.phone, c.unit]));
    const csv = rows.map(r => r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clientes-chat.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Users className="w-8 h-8 text-[#FF6600]" />
            Clientes do Chat
          </h1>
          <p className="text-gray-400 mt-1">Lista de todos os clientes únicos que iniciaram conversa</p>
        </div>
        <Button onClick={downloadCSV} className="bg-[#FF6600] hover:bg-[#e55c00] gap-2">
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-400">
            Total: <span className="text-white font-bold">{data.total}</span> clientes
            {search && <span className="ml-2">({filtered.length} filtrados)</span>}
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              className="pl-9 bg-white/5 border-white/10"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">Carregando...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-white/10">
                  <th className="py-2 px-3 w-12">#</th>
                  <th className="py-2 px-3">Nome</th>
                  <th className="py-2 px-3">Telefone</th>
                  <th className="py-2 px-3">Unidade</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 px-3 text-gray-500">{i + 1}</td>
                    <td className="py-2 px-3 text-white">{c.name}</td>
                    <td className="py-2 px-3 text-gray-300">{c.phone}</td>
                    <td className="py-2 px-3 text-gray-400">{c.unit || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}