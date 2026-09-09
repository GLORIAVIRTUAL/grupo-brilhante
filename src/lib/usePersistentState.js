import { useEffect, useState } from 'react';

// Estado que sobrevive à troca de página (persistido no localStorage).
export default function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved !== null ? JSON.parse(saved) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage indisponível — segue apenas em memória
    }
  }, [key, value]);

  return [value, setValue];
}