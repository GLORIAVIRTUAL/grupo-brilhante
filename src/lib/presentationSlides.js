// Conteúdo da apresentação do sistema para a franqueadora 5àsec.
export const slides = [
  {
    kind: 'cover',
    image: 'https://media.base44.com/images/public/6998e8554cc6b3863e37588a/308dcb734_generated_image.png',
    eyebrow: 'Apresentação institucional',
    title: 'O sistema de gestão e atendimento feito para as franquias 5àsec',
    subtitle:
      'Chat com IA (Glória) + atendimento humano, CRM de pedidos, coletas, disparos, gestão financeira, dashboard e marketing — tudo em um só lugar.',
    footnote: 'Validado por 6 meses em operação real nas unidades de Porto Alegre.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 1',
    title: 'Chat com IA (Glória) + atendimento humano',
    subtitle:
      'A Glória atende no WhatsApp 24h: responde preços do catálogo, monta orçamento, agenda coleta e passa para a atendente quando precisa.',
    bullets: [
      'Responde no mesmo número da loja, com a identidade da unidade.',
      'Omnichannel: recebe conversas do WhatsApp, da landing page, do Instagram e do Messenger do Facebook em um só lugar.',
      'Preços sempre do catálogo cadastrado — sem valor inventado.',
      'O cliente manda a foto das peças e a IA identifica o tipo de peça e monta o orçamento.',
      'O orçamento fica no CRM para conferência manual da equipe, que pode refazer peça por peça.',
      'A atendente assume a conversa a qualquer momento, sem perder o histórico.'
    ],
    advantage:
      'Vantagem sobre outros sistemas: aqui a IA não é um chatbot de menu — ela vende, orça e agenda com as regras da 5àsec.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 2',
    title: 'Pedidos e CRM em kanban',
    subtitle: 'Cada conversa vira card: novo cliente, orçamento, pagamento, pedido e reclamação.',
    bullets: [
      'Todo contato novo entra no CRM automaticamente.',
      'Orçamento, aprovação, comprovante e pedido em uma única esteira.',
      'Reclamações com prioridade e responsável definido.',
      'Ticket, valor e prazo visíveis para toda a equipe.'
    ],
    advantage: 'Vantagem: nada depende da memória da atendente — o funil é o sistema.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 3',
    title: 'Disparos para a base da loja',
    subtitle: 'Campanhas e lembretes enviados para a base que o próprio atendimento construiu.',
    bullets: [
      'Aniversário, cliente inativo, pesquisa de satisfação e promoções.',
      'Filtro de público por unidade, consentimento e histórico.',
      'Fila com agendamento, status de envio e relatório.',
      'Quem responde ao disparo cai direto na Glória e continua o atendimento.'
    ],
    advantage: 'Vantagem: a base é sua, não da plataforma — cada disparo volta como orçamento.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 4',
    title: 'Coletas e roteirização',
    subtitle: 'Agenda de coleta com capacidade real por turno e rota otimizada para o entregador.',
    bullets: [
      'Manhã e tarde com vagas controladas — sem agendar em dia lotado.',
      'A IA consulta a agenda real antes de oferecer qualquer horário.',
      'Remarcação sem repetir endereço nem forma de pagamento.',
      'Rota do dia otimizada e relatório de coletas.'
    ],
    advantage: 'Vantagem: a coleta cresce sem contratar ninguém para atender no WhatsApp.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 5',
    title: 'Gestão financeira',
    subtitle: 'Vendas, despesas fixas e avulsas, taxas de maquininha e DRE da unidade.',
    bullets: [
      'Entradas e saídas por forma de pagamento e por unidade.',
      'Taxas de cartão por bandeira e parcela já descontadas.',
      'Despesas recorrentes lançadas automaticamente todo mês.',
      'Log de auditoria: quem apagou, o que apagou e por quê.'
    ],
    advantage: 'Vantagem: o franqueado enxerga a margem real, não só o faturamento.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 6',
    title: 'Dashboard interativo',
    subtitle: 'A operação do dia em uma tela: atendimento, coletas, vendas e produção.',
    bullets: [
      'Coletas e vendas do dia em tempo real.',
      'Fábrica visual: lavagem, secagem, lavagem a seco e passadoria com tempo de ciclo.',
      'Alertas sonoros de nova mensagem, orçamento aprovado e venda.',
      'Relatórios em PDF para enviar à franqueadora.'
    ],
    advantage: 'Vantagem: decisão no mesmo dia, com dado da própria loja.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 7',
    title: 'Marketing: criação + tráfego',
    subtitle: 'Criação de campanha com IA e gestão de tráfego Meta e Google dentro do sistema.',
    bullets: [
      'Geração de criativos e textos para as campanhas da loja.',
      'As imagens geradas pela IA seguem o padrão de marketing vigente da franqueadora.',
      'Campanhas da rede compartilhadas entre unidades.',
      'Tráfego Meta e Google criado e acompanhado no painel.',
      'Resultado ligado ao CRM: o lead da campanha cai no atendimento.',
      'A unidade dispensa o custo de uma agência local de marketing.'
    ],
    advantage: 'Vantagem: campanha e atendimento no mesmo sistema — nada se perde entre agência e loja, e a loja economiza a mensalidade da agência.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 8',
    title: 'Acesso da franqueadora',
    subtitle: 'A franqueadora acompanha todos os relatórios do sistema, atualizados em tempo real.',
    bullets: [
      'Acesso a todos os relatórios de todas as unidades, sem pedir nada à loja.',
      'Dados em tempo real: atendimento, orçamentos, coletas, vendas e financeiro.',
      'Comparação entre unidades com o mesmo critério de medição.',
      'Relatórios exportáveis em PDF para reuniões e acompanhamento da rede.'
    ],
    advantage: 'Vantagem: a franqueadora enxerga a rede pelo dado real da operação, não por planilha enviada pela loja.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 9',
    title: 'Integração bancária e maquininha',
    subtitle: 'A Glória vende pelo WhatsApp com link de pagamento e a venda já entra conciliada.',
    bullets: [
      'A IA envia link de Pix e de cartão de crédito direto na conversa.',
      'Pagamento confirmado pelo banco atualiza o pedido automaticamente.',
      'Integração com a maquininha do banco do cliente para contabilizar as vendas.',
      'Sem conferência manual de extrato: a venda entra na gestão já batida com o banco.'
    ],
    advantage: 'Vantagem: fecha a venda no WhatsApp e elimina o trabalho diário de conciliação com o banco.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 10',
    title: 'Ligações telefônicas com IA que fala',
    subtitle: 'Chamadas recebidas e feitas dentro do sistema, atendidas pela IA por voz.',
    bullets: [
      'A IA atende e também faz ligações direto do sistema.',
      'Toda a conversa é transcrita no chat e o áudio fica gravado.',
      'Na própria ligação a IA agenda coleta, monta orçamento e envia link de pagamento no WhatsApp do cliente.',
      'Pode ficar ativa 24h ou só nos horários em que a unidade está fechada.',
      'Portabilidade do fixo da unidade: a loja mantém o mesmo número.',
      'Disponível no Plano 3.'
    ],
    advantage: 'Vantagem: uma atendente que fala igual humano, sem fila de espera e sem ligação perdida.'
  },
  {
    kind: 'feature',
    eyebrow: 'Módulo 11',
    title: 'Versão web e aplicativo iOS e Android',
    subtitle: 'A mesma operação no PC da loja e no celular da equipe, com todas as funções.',
    bullets: [
      'Aplicativo iOS e Android com acesso a todas as funções do sistema.',
      'Chat no aplicativo com notificação no celular a cada nova conversa.',
      'Coletas, orçamentos, pedidos e financeiro também pelo celular.',
      'Versão web para gerir tudo de um PC, sem instalar nada.',
      'Sem limite de usuários em nenhum dos planos.'
    ],
    advantage: 'Vantagem: a loja atende de onde estiver e toda a equipe usa o sistema sem custo por usuário.'
  },
  {
    kind: 'feature',
    eyebrow: 'Ganho de operação',
    title: 'Mais tempo para a equipe fazer o que gera valor',
    subtitle:
      'A Glória absorve a repetição do WhatsApp: preço, prazo, endereço, horário e agendamento.',
    bullets: [
      'A atendente deixa de digitar a mesma resposta dezenas de vezes por dia.',
      'A loja segue atendendo à noite, no fim de semana e no horário de pico.',
      'A equipe foca em conferência de peças, qualidade e venda no balcão.',
      'Nenhum contato fica sem resposta esperando alguém liberar.'
    ],
    advantage: 'Vantagem: a mesma equipe passa a dar conta de um volume maior de pedidos.'
  },
  {
    kind: 'support',
    eyebrow: 'Suporte',
    title: 'Suporte 24h com superagente + consultor humano',
    subtitle: 'Um grupo de Telegram por unidade, com o superagente do sistema dentro dele.',
    bullets: [
      'Responde dúvidas sobre o sistema e sobre os dados do banco da sua unidade.',
      'Recebe aviso de bug e registra na hora, sem formulário.',
      'Aceita sugestões de mudança e melhoria do sistema.',
      'Disponível 24 horas por dia, todos os dias.',
      'Consultor humano no mesmo grupo para o que exigir decisão.'
    ],
    advantage: 'Vantagem: suporte no canal que a equipe já usa, sem fila de ticket.'
  },
  {
    kind: 'security',
    eyebrow: 'Segurança e LGPD',
    title: 'Proteção de dados por design, conforme a LGPD',
    subtitle: 'Política institucional de segurança da Glória Virtual aplicada a todo o sistema.',
    bullets: [
      'Criptografia dos dados em trânsito e em repouso, com conexões HTTPS/TLS.',
      'Login por usuário, perfis por função e princípio do menor privilégio.',
      'Segregação lógica: cada unidade acessa apenas os próprios registros.',
      'Chaves e tokens guardados em ambiente de segredos, fora do código.',
      'IA com supervisão humana e caminho de atendimento humano em casos críticos.',
      'Backup do código em GitHub privado e dos dados em Google Cloud Storage, duas vezes ao dia (12h e 22h).',
      'Plano de contingência de LLM para restabelecer o atendimento em caso de indisponibilidade.',
      'Checklist de segurança obrigatório antes da entrada em produção.'
    ],
    advantage: 'Documento institucional versão 1.3 — disponível na íntegra para o jurídico da franqueadora.',
    download: {
      label: 'Baixar política completa (PDF)',
      url: 'https://media.base44.com/files/public/6998e8554cc6b3863e37588a/b0ff09874_Seguranca_Aplicativos_e_Sistemas_Gloria_Virtual_v131.pdf'
    }
  },
  {
    kind: 'stats',
    eyebrow: 'Resultados da validação',
    title: '6 meses de teste em unidades reais de Porto Alegre',
    subtitle: 'Números medidos dentro do próprio sistema, sem investimento em divulgação.',
    stats: [
      { value: '20%', label: 'dos clientes atendidos fora do horário comercial', detail: 'Clientes que não seriam atendidos e poderiam ser perdidos.' },
      { value: '10%', label: 'das coletas agendadas sozinhas pela IA', detail: 'Sem nenhuma campanha de marketing divulgando o canal.' },
      { value: '25%', label: 'dos orçamentos gerados pela IA', detail: 'Orçamento com preço do catálogo, sem erro de cálculo.' },
      { value: '100%', label: 'dos novos contatos dentro do CRM', detail: 'Base própria pronta para disparos e campanhas.' }
    ]
  },
  {
    kind: 'plans',
    discount:
      'Atenção: todos os valores abaixo já estão com 30% de desconto sobre o preço normalmente cobrado, condição especial para a homologação do sistema perante a franqueadora. Franqueados com mais de uma unidade, gerindo todas no mesmo sistema, têm desconto adicional — valor a consultar caso a caso.',
    eyebrow: 'Investimento',
    title: 'Três planos por unidade',
    subtitle: 'Escolha pelo estágio da loja — a troca de plano é imediata. Landing page grátis da unidade inclusa em todos os planos.',
    plans: [
      {
        name: 'Plano 1',
        price: 'R$ 789,00',
        period: '/mês por unidade',
        items: ['Chat com IA (Glória) + atendimento humano', 'Pedidos e CRM', 'Coletas com roteirização', 'Dashboard e gestão', 'Landing page grátis para a unidade']
      },
      {
        name: 'Plano 2',
        price: 'R$ 989,00',
        period: '/mês por unidade',
        highlight: true,
        items: ['Tudo do Plano 1', 'Disparos automáticos e campanhas na base', 'Aniversário, inativos e pesquisa de satisfação']
      },
      {
        name: 'Plano 3',
        price: 'R$ 1.289,00',
        period: '/mês por unidade',
        items: ['Tudo do Plano 2', 'Marketing: criação de campanhas com IA', 'Tráfego Meta e Google no painel', 'Ligações telefônicas com IA que fala (com portabilidade do fixo)']
      }
    ],
    extra: {
      title: 'Custos extras de uso',
      text:
        'Tokens da API do ChatGPT: medidos dentro do próprio sistema e acrescentados à mensalidade, média de R$ 39,90 a cada mil conversas. Ligações telefônicas (Plano 3): média de R$ 1,00 por ligação recebida ou realizada + R$ 25,00/mês da empresa de telefonia. Você paga apenas o uso do mês, sem pacote fechado.'
    }
  },
  {
    kind: 'closing',
    eyebrow: 'Próximo passo',
    title: 'A 5àsec merece um sistema à altura da sua marca',
    manifesto: [
      'Inovação está no DNA da 5àsec — e a tecnologia que atende o cliente precisa acompanhar esse mesmo padrão.',
      'A maior rede de lavanderias do mundo não pode depender de atendimento manual, planilhas soltas e contatos perdidos no WhatsApp. Inteligência artificial, CRM e automação já são o presente do varejo de serviços.',
      'Este sistema foi construído dentro da operação 5àsec, testado em unidades reais e pronto para escalar em toda a rede — com a mesma exigência de qualidade que a marca leva para cada peça entregue.'
    ],
    signature: 'Vamos colocar a rede 5àsec um passo à frente.',
    footnote: 'Desenvolvido por gloriavirtual.com'
  }
];