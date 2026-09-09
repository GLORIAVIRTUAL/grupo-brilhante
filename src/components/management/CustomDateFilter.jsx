import React from 'react';
import { Filter, CalendarRange } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function CustomDateFilter({ dateRange, setDateRange, customStart, customEnd, setCustomStart, setCustomEnd }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
        <Filter className="h-4 w-4 text-gray-400" />
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="h-8 w-32 border-0 bg-transparent"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="all">Todo o período</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {dateRange === 'custom' && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 border-white/10 bg-white/5 text-white hover:bg-white/10">
              <CalendarRange className="h-4 w-4 text-[#FF6600]" />
              {customStart && customEnd ? `${customStart} → ${customEnd}` : 'Selecionar período'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 bg-[#1a0b36] border-white/10 text-white space-y-3">
            <div className="space-y-1">
              <Label className="text-sm">Data inicial</Label>
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="bg-white/5 border-white/10" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Data final</Label>
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="bg-white/5 border-white/10" />
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}