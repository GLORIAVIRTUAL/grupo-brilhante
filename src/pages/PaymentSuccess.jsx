import React, { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ShoppingBag, Home } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import canvasConfetti from 'canvas-confetti';

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const quoteId = searchParams.get('quote_id');

  useEffect(() => {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };
    const randomInRange = (min, max) => Math.random() * (max - min) + min;

    const interval = setInterval(function() {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) return clearInterval(interval);
      const particleCount = 50 * (timeLeft / duration);
      canvasConfetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
      canvasConfetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#1a0b36] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-8 text-center shadow-2xl shadow-purple-900/20">
        <motion.div 
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/30"
        >
          <CheckCircle2 className="w-12 h-12 text-white" />
        </motion.div>
        
        <h1 className="text-3xl font-bold text-white mb-2">Pagamento Confirmado!</h1>
        <p className="text-gray-300 mb-8">
          Obrigado! Seu pagamento foi processado com sucesso. Já estamos cuidando do seu pedido.
        </p>

        {quoteId && (
          <div className="bg-white/5 rounded-lg p-4 mb-8 border border-white/5">
            <p className="text-sm text-gray-400 mb-1">Referência do Pedido</p>
            <p className="font-mono text-[#FF6600] font-bold tracking-wider">#{quoteId.slice(0, 8).toUpperCase()}</p>
          </div>
        )}

        <div className="space-y-3">
          <Link to="/Landing">
            <Button className="w-full bg-[#FF6600] hover:bg-[#ff7b24] text-white h-12 text-lg">
              <Home className="w-5 h-5 mr-2" />
              Voltar ao Início
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}