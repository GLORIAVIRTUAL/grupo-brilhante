import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, FileText, Search } from 'lucide-react';
import { format } from 'date-fns';
import { formatBrasiliaDateTime } from '@/lib/pickupDateTime';
import { jsPDF } from 'jspdf';

export default function PickupsTable({ pickups, customerMap }) {
    const [searchName, setSearchName] = useState('');
    const [filterNeighborhood, setFilterNeighborhood] = useState('all');
    const [filterFee, setFilterFee] = useState('all');

    const uniqueNeighborhoods = useMemo(() => {
        const neighborhoods = new Set(pickups.map(p => p.neighborhood || '-').filter(Boolean));
        return Array.from(neighborhoods).sort();
    }, [pickups]);

    const filteredPickups = useMemo(() => {
        return pickups.filter(p => {
            const customerName = (customerMap[p.customer_id] || 'Desconhecido').toLowerCase();
            if (searchName && !customerName.includes(searchName.toLowerCase())) return false;
            
            if (filterNeighborhood !== 'all' && (p.neighborhood || '-') !== filterNeighborhood) return false;
            
            const isFree = !p.fee || p.fee === 0;
            if (filterFee === 'gratis' && !isFree) return false;
            if (filterFee === 'pago' && isFree) return false;
            
            return true;
        });
    }, [pickups, customerMap, searchName, filterNeighborhood, filterFee]);

    const exportToCSV = () => {
        const headers = ['Data/Hora', 'Cliente', 'Bairro', 'Endereço', 'Taxa', 'Status'];
        const rows = filteredPickups.map(p => {
            const date = p.scheduled_at ? formatBrasiliaDateTime(p.scheduled_at).replace(' às ', ' ') : '-';
            const customer = customerMap[p.customer_id] || 'Desconhecido';
            const neighborhood = p.neighborhood || '-';
            const address = p.address ? p.address.replace(/;/g, '') : '-';
            const fee = (!p.fee || p.fee === 0) ? 'Grátis' : `R$ ${p.fee.toFixed(2)}`;
            const status = p.status === 'scheduled' ? 'Agendada' : p.status === 'completed' ? 'Concluída' : p.status === 'cancelled' ? 'Cancelada' : p.status;
            return `"${date}";"${customer}";"${neighborhood}";"${address}";"${fee}";"${status}"`;
        });
        
        const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(';')].concat(rows).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "relatorio_coletas_excel.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportToPDF = async () => {
        const pdf = new jsPDF('l', 'mm', 'a4'); // Landscape
        
        // Colors
        const primaryColor = [26, 11, 54]; // Dark background #1a0b36 matching the app theme
        const accentColor = [255, 102, 0]; // #FF6600
        const darkGray = [60, 60, 60];
        const lightGray = [240, 240, 240];
        
        // Load Logo
        const loadImage = (url) => new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = url;
        });

        const logoImg = await loadImage("https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6998e8554cc6b3863e37588a/0d0351520_image.png");
        
        // Header Background
        pdf.setFillColor(...primaryColor);
        pdf.rect(0, 0, 297, 40, 'F');
        
        if (logoImg) {
            // Adjust logo dimensions to fit well
            pdf.addImage(logoImg, 'PNG', 14, 10, 60, 18);
        }
        
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(22);
        pdf.setFont(undefined, 'bold');
        pdf.text("Relatório de Coletas", 283, 20, { align: 'right' });
        
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'normal');
        pdf.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 283, 28, { align: 'right' });
        
        // Table headers
        let y = 50;
        
        const drawHeaders = (startY) => {
            pdf.setFillColor(...lightGray);
            pdf.rect(14, startY - 6, 269, 10, 'F');
            
            pdf.setFontSize(11);
            pdf.setTextColor(...primaryColor);
            pdf.setFont(undefined, 'bold');
            pdf.text('Data/Hora', 16, startY);
            pdf.text('Cliente', 50, startY);
            pdf.text('Bairro', 110, startY);
            pdf.text('Endereço', 160, startY);
            pdf.text('Taxa', 235, startY);
            pdf.text('Status', 260, startY);
            return startY + 8;
        };
        
        y = drawHeaders(y);
        
        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(10);
        
        filteredPickups.forEach((p, index) => {
            if (y > 190) { // New page
                pdf.addPage();
                
                // Header Background
                pdf.setFillColor(...primaryColor);
                pdf.rect(0, 0, 297, 25, 'F');
                
                if (logoImg) {
                    pdf.addImage(logoImg, 'PNG', 14, 5, 40, 12);
                }
                
                pdf.setTextColor(255, 255, 255);
                pdf.setFontSize(14);
                pdf.setFont(undefined, 'bold');
                pdf.text("Relatório de Coletas (Continuação)", 283, 15, { align: 'right' });
                
                y = 35;
                y = drawHeaders(y);
                pdf.setFont(undefined, 'normal');
                pdf.setFontSize(10);
            }

            // Alternating row background
            if (index % 2 === 0) {
                pdf.setFillColor(250, 250, 250);
                pdf.rect(14, y - 5, 269, 8, 'F');
            }

            const date = p.scheduled_at ? formatBrasiliaDateTime(p.scheduled_at).replace(' às ', ' ') : '-';
            const customer = (customerMap[p.customer_id] || 'Desconhecido').substring(0, 30);
            const neighborhood = (p.neighborhood || '-').substring(0, 25);
            const address = (p.address || '-').substring(0, 45);
            const fee = (!p.fee || p.fee === 0) ? 'Grátis' : `R$ ${p.fee.toFixed(2)}`;
            const status = p.status === 'scheduled' ? 'Agendada' : p.status === 'completed' ? 'Concluída' : p.status === 'cancelled' ? 'Cancelada' : p.status;

            pdf.setTextColor(...darkGray);
            pdf.text(date, 16, y);
            pdf.text(customer, 50, y);
            pdf.text(neighborhood, 110, y);
            pdf.text(address, 160, y);
            
            // Highlight free or fee
            if (!p.fee || p.fee === 0) {
                pdf.setTextColor(0, 150, 0);
            } else {
                pdf.setTextColor(...darkGray);
            }
            pdf.text(fee, 235, y);
            
            // Colored Status
            if (status === 'Concluída') pdf.setTextColor(0, 150, 0);
            else if (status === 'Cancelada') pdf.setTextColor(200, 0, 0);
            else pdf.setTextColor(...accentColor);
            
            pdf.text(status, 260, y);
            
            y += 8;
        });

        // Footer
        const pageCount = pdf.internal.getNumberOfPages();
        for(let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);
            pdf.setTextColor(150);
            pdf.setFontSize(8);
            pdf.text(`Página ${i} de ${pageCount}`, 148, 205, { align: 'center' });
        }

        pdf.save('relatorio_coletas.pdf');
    };

    return (
        <Card className="bg-white/5 border-white/10 mt-6">
            <CardHeader className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                <CardTitle>Lista Descritiva de Coletas</CardTitle>
                
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                        <Input
                            placeholder="Buscar cliente..."
                            value={searchName}
                            onChange={(e) => setSearchName(e.target.value)}
                            className="pl-9 bg-white/5 border-white/10 text-sm h-9 w-[180px] lg:w-[200px]"
                        />
                    </div>
                    
                    <Select value={filterNeighborhood} onValueChange={setFilterNeighborhood}>
                        <SelectTrigger className="w-[160px] bg-white/5 border-white/10 h-9 text-sm">
                            <SelectValue placeholder="Bairro" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos os Bairros</SelectItem>
                            {uniqueNeighborhoods.map(nb => (
                                <SelectItem key={nb} value={nb}>{nb}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={filterFee} onValueChange={setFilterFee}>
                        <SelectTrigger className="w-[120px] bg-white/5 border-white/10 h-9 text-sm">
                            <SelectValue placeholder="Taxa" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas as Taxas</SelectItem>
                            <SelectItem value="gratis">Grátis</SelectItem>
                            <SelectItem value="pago">Paga</SelectItem>
                        </SelectContent>
                    </Select>

                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={exportToCSV} className="gap-2 bg-transparent text-white border-white/20 hover:bg-white/10 h-9">
                            <FileText className="w-4 h-4" />
                            Excel
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportToPDF} className="gap-2 bg-transparent text-white border-white/20 hover:bg-white/10 h-9">
                            <Download className="w-4 h-4" />
                            PDF
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border border-white/10 overflow-hidden">
                    <div className="overflow-x-auto max-h-[400px]">
                        <Table>
                            <TableHeader className="bg-black/20">
                                <TableRow className="border-white/10 hover:bg-transparent">
                                    <TableHead className="text-gray-400">Data/Hora</TableHead>
                                    <TableHead className="text-gray-400">Cliente</TableHead>
                                    <TableHead className="text-gray-400">Bairro</TableHead>
                                    <TableHead className="text-gray-400">Endereço</TableHead>
                                    <TableHead className="text-gray-400">Taxa</TableHead>
                                    <TableHead className="text-gray-400">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredPickups.length === 0 ? (
                                    <TableRow className="border-white/10">
                                        <TableCell colSpan={6} className="text-center text-gray-500 py-8">Nenhuma coleta encontrada</TableCell>
                                    </TableRow>
                                ) : (
                                    filteredPickups.map(p => (
                                        <TableRow key={p.id} className="border-white/10 hover:bg-white/5 transition-colors text-gray-200">
                                            <TableCell className="whitespace-nowrap">
                                                {p.scheduled_at ? formatBrasiliaDateTime(p.scheduled_at).replace(' às ', ' ') : '-'}
                                            </TableCell>
                                            <TableCell>{customerMap[p.customer_id] || 'Desconhecido'}</TableCell>
                                            <TableCell>{p.neighborhood || '-'}</TableCell>
                                            <TableCell className="max-w-[200px] truncate" title={p.address}>{p.address || '-'}</TableCell>
                                            <TableCell>
                                                {(!p.fee || p.fee === 0) ? (
                                                    <span className="text-green-500 font-medium">Grátis</span>
                                                ) : (
                                                    `R$ ${p.fee.toFixed(2)}`
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                    p.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                                    p.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                                                    'bg-blue-500/20 text-blue-400'
                                                }`}>
                                                    {p.status === 'scheduled' ? 'Agendada' : p.status === 'completed' ? 'Concluída' : p.status === 'cancelled' ? 'Cancelada' : p.status}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}