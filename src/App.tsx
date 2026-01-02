import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Upload, Loader2, AlertCircle, Copy, Key, Scissors, Zap, Activity, ChevronRight, Download, FileText, Sparkles, TrendingUp, Briefcase, GraduationCap, LayoutList, HelpCircle, X, User, History, Search, Globe, RotateCcw, Trash2, Save } from 'lucide-react';

// --- 音訊處理工具函式 (維持不變) ---
const bufferToWavBlob = (audioBuffer: AudioBuffer): Blob => {
  const numOfChan = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i, sample;
  let offset = 0;
  let pos = 0;

  const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
  const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM
  setUint16(numOfChan);
  setUint32(audioBuffer.sampleRate);
  setUint32(audioBuffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4);

  for (i = 0; i < audioBuffer.numberOfChannels; i++) channels.push(audioBuffer.getChannelData(i));

  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([buffer], { type: "audio/wav" });
};

const resampleAndToMono = async (audioBuffer: AudioBuffer, targetSampleRate = 16000): Promise<AudioBuffer> => {
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * targetSampleRate, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  return await offlineCtx.startRendering();
};

const correctAndFilterTimestamps = (text: string, offsetSeconds: number, lastTimestampSeconds: number): { text: string, newLastTimestamp: number } => {
  let currentLastTimestamp = lastTimestampSeconds;
  const correctedText = text.replace(/\[(\d{1,2}):(\d{2})\]/g, (match, mm, ss) => {
    const originalSeconds = parseInt(mm) * 60 + parseInt(ss);
    const absoluteSeconds = originalSeconds + offsetSeconds;
    const timeDiff = absoluteSeconds - currentLastTimestamp;
    if (timeDiff < 110 && currentLastTimestamp > 0) return ""; 
    currentLastTimestamp = absoluteSeconds;
    const newMM = Math.floor(absoluteSeconds / 60);
    const newSS = Math.floor(absoluteSeconds % 60);
    return `\n[${newMM.toString().padStart(2, '0')}:${newSS.toString().padStart(2, '0')}] `;
  });
  return { text: correctedText, newLastTimestamp: currentLastTimestamp };
};

// --- 視覺元件 ---
const AudioVisualizer = ({ isProcessing }: { isProcessing: boolean }) => {
  return (
    <div className="flex items-center justify-center gap-1.5 h-16 w-full mt-4 overflow-hidden">
      {Array.from({ length: 16 }).map((_, i) => (
        <div
          key={i}
          className={`w-2 bg-brand rounded-full transition-all duration-300 ease-in-out shadow-[0_0_10px_rgba(204,255,0,0.3)] ${isProcessing ? 'animate-pulse' : ''}`}
          style={{
            height: isProcessing ? `${Math.max(20, Math.random() * 100)}%` : '15%',
            animationDelay: `${i * 0.1}s`,
            animationDuration: '0.6s'
          }}
        />
      ))}
    </div>
  );
};

// --- Types ---
type SummaryMode = 'FINANCE' | 'MEETING' | 'LECTURE' | 'GENERAL';

interface HistoryItem {
  id: string;
  timestamp: number;
  fileName: string;
  transcript: string;
  summary: string;
}

const App = () => {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showSettings, setShowSettings] = useState(!apiKey);
  const [file, setFile] = useState<File | null>(null);
  
  // Processing States
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  
  const [progressStatus, setProgressStatus] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  
  // Results
  const [transcript, setTranscript] = useState<string>('');
  const [summary, setSummary] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary'>('transcript');
  const [currentMode, setCurrentMode] = useState<SummaryMode>('GENERAL');
  
  const [error, setError] = useState<string>('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New Features State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('English');

  const todayDate = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  useEffect(() => {
    if (apiKey) localStorage.setItem('gemini_api_key', apiKey);
  }, [apiKey]);

  // Load History
  useEffect(() => {
    const saved = localStorage.getItem('gamer_voice_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history");
      }
    }
  }, []);

  const saveToHistory = (newTranscript: string, newSummary: string, fileName: string) => {
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      fileName: fileName,
      transcript: newTranscript,
      summary: newSummary
    };
    
    // Keep only last 5 items
    const updatedHistory = [newItem, ...history].slice(0, 5);
    setHistory(updatedHistory);
    localStorage.setItem('gamer_voice_history', JSON.stringify(updatedHistory));
  };

  const loadFromHistory = (item: HistoryItem) => {
    setTranscript(item.transcript);
    setSummary(item.summary);
    setFile({ name: item.fileName, size: 0 } as File); // Mock file object for display
    setShowHistory(false);
    setError('');
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedHistory = history.filter(item => item.id !== id);
    setHistory(updatedHistory);
    localStorage.setItem('gamer_voice_history', JSON.stringify(updatedHistory));
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  };

  const handleFile = (selectedFile: File) => {
    const validTypes = ['audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/ogg', 'video/mp4', 'audio/webm', 'video/webm'];
    const validExts = /\.(mp3|wav|m4a|mp4|aac|ogg|webm|mov)$/i;
    if (validTypes.includes(selectedFile.type) || validExts.test(selectedFile.name)) {
      setFile(selectedFile);
      setError(''); setTranscript(''); setSummary(''); setProgressStatus(''); setProgressPercent(0); setActiveTab('transcript');
    } else {
      setError('不支援的檔案格式，請上傳 MP3/WAV/MP4。');
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // --- 核心轉錄功能 ---
  const processAndTranscribe = async () => {
    if (!file) return;
    if (!apiKey) {
      setError("請先輸入 Google API Key。");
      setShowSettings(true);
      return;
    }

    setIsProcessing(true); setError(''); setTranscript(''); setSummary(''); setProgressPercent(0);

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const systemInstruction = `
你是一位專業的逐字稿速記員與翻譯專家。你的任務是精確地將音訊檔案轉錄為文字。
請嚴格遵守以下規則：
1. **講者辨識一致性**：這是連續音檔。請務必根據「前段重疊內容」校正講者身分 (講者 A, 講者 B)。
2. **時間標記**：請每隔 1-2 分鐘或講者切換時加入 [MM:SS]。
3. **語言**：中文請用「台灣繁體中文」。
4. **完整性**：請盡可能完整記錄對話內容，不要摘要。
      `;

      setProgressStatus('初始化音訊...');
      const arrayBuffer = await file.arrayBuffer();
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      setProgressStatus(`重取樣中...`);
      const lowResBuffer = await resampleAndToMono(decodedBuffer, 16000);

      const CHUNK_DURATION = 540; 
      const OVERLAP_DURATION = 20; 
      const totalDuration = lowResBuffer.duration;
      const chunks = Math.ceil(totalDuration / CHUNK_DURATION);
      
      let fullTranscript = "";
      let lastTranscriptContext = ""; 
      let lastTimestampGlobal = 0; 

      for (let i = 0; i < chunks; i++) {
        const realStartTime = i * CHUNK_DURATION; 
        const audioStartTime = Math.max(0, realStartTime - OVERLAP_DURATION);
        const audioEndTime = Math.min(totalDuration, (i + 1) * CHUNK_DURATION);
        const chunkDuration = audioEndTime - audioStartTime;
        
        setProgressStatus(`轉譯中... 片段 ${i + 1} / ${chunks}`);
        setProgressPercent(Math.round(((i) / chunks) * 100));

        const lengthInSamples = Math.floor(chunkDuration * 16000);
        const startSample = Math.floor(audioStartTime * 16000);
        
        const chunkBuffer = new AudioContext().createBuffer(1, lengthInSamples, 16000);
        const channelData = lowResBuffer.getChannelData(0).subarray(startSample, startSample + lengthInSamples);
        chunkBuffer.copyToChannel(channelData, 0);

        const wavBlob = bufferToWavBlob(chunkBuffer);
        const base64Audio = await blobToBase64(wavBlob);

        const overlapInstruction = i > 0 
            ? `**重要：聲紋校正**\n此音檔前 ${OVERLAP_DURATION} 秒是上一段重疊。請對照下方文字確認講者，並**從 20 秒後**開始轉錄。` 
            : "**這是音檔的第一部分，請從 00:00 開始完整轉錄。**";

        const calibrationContext = lastTranscriptContext ? `\n\n【重疊參考】\n"""\n${lastTranscriptContext.slice(-300)}\n"""\n` : "";
        const prompt = `音訊第 ${i + 1}/${chunks} 部分。\n${overlapInstruction}\n${calibrationContext}\n請開始轉錄。`;

        const result = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [{ inlineData: { mimeType: 'audio/wav', data: base64Audio } }, { text: prompt }] },
            config: { temperature: 0.2, systemInstruction: systemInstruction }
        });

        let rawText = result.text || "";
        const { text: correctedText, newLastTimestamp } = correctAndFilterTimestamps(rawText, audioStartTime, lastTimestampGlobal);
        lastTimestampGlobal = newLastTimestamp; 
        lastTranscriptContext = rawText.slice(-800);
        fullTranscript += correctedText;
        setTranscript(fullTranscript);
      }
      setProgressStatus('轉錄完成');
      setProgressPercent(100);
      
      // Save to history automatically
      saveToHistory(fullTranscript, "", file.name);

    } catch (err: any) {
      console.error(err);
      let errorMsg = "未知錯誤";
      if (err.message?.includes('500')) errorMsg = "伺服器錯誤 (500)";
      else if (err.message) errorMsg = `錯誤: ${err.message}`;
      setError(errorMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- 摘要生成功能 ---
  const generateSummary = async (text: string, mode: SummaryMode | 'AUTO') => {
    if (!text || !apiKey) return;
    setIsSummarizing(true);
    setActiveTab('summary');

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      let modePrompt = "";
      
      if (mode === 'AUTO') {
        modePrompt = `請分析內容判斷類型(財經/會議/課程/一般)並輸出摘要。`;
      } else if (mode === 'FINANCE') {
        setCurrentMode('FINANCE');
        modePrompt = `模式：財經投資。請列出：個股表格(代碼/看法)、市場趨勢、關鍵數據、投資建議。`;
      } else if (mode === 'MEETING') {
        setCurrentMode('MEETING');
        modePrompt = `模式：商務會議。請列出：主旨、決策、待辦事項(負責人/期限)、重點討論。`;
      } else if (mode === 'LECTURE') {
        setCurrentMode('LECTURE');
        modePrompt = `模式：課程講座。請列出：核心觀念、邏輯大綱、名詞解釋、考試重點。`;
      } else {
        setCurrentMode('GENERAL');
        modePrompt = `模式：通用總結。請列出：內容大意(300字)、時間軸亮點、金句。`;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [{ text: `以下是音訊逐字稿：\n"""\n${text}\n"""\n\n${modePrompt}` }] },
        config: { temperature: 0.3 }
      });

      const newSummary = response.text || "摘要生成失敗";
      setSummary(newSummary);
      
      // Update history with summary
      if (file) {
        saveToHistory(transcript, newSummary, file.name);
      }
    } catch (e: any) {
        setSummary(`摘要生成發生錯誤: ${e.message}`);
    } finally {
        setIsSummarizing(false);
    }
  };

  // --- 翻譯功能 ---
  const handleTranslate = async () => {
    if (!apiKey) return;
    const contentToTranslate = activeTab === 'transcript' ? transcript : summary;
    if (!contentToTranslate) return;

    setIsTranslating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [{ text: `請將以下內容翻譯成 ${targetLang}，保持原有的格式（如時間軸、Markdown 表格等）：\n\n${contentToTranslate}` }] },
      });
      
      const translatedText = response.text || "";
      if (activeTab === 'transcript') {
        setTranscript(translatedText);
      } else {
        setSummary(translatedText);
      }
    } catch (e: any) {
      setError(`翻譯失敗: ${e.message}`);
    } finally {
      setIsTranslating(false);
    }
  };

  // --- 搜尋取代功能 ---
  const handleFindReplace = () => {
    if (!findText) return;
    try {
      const regex = new RegExp(findText, 'g');
      const newText = transcript.replace(regex, replaceText);
      setTranscript(newText);
      // Auto save after edit
      if(file) saveToHistory(newText, summary, file.name);
    } catch (e) {
      setError("搜尋字串格式錯誤 (請檢查 Regex 語法)");
    }
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  const downloadFile = (content: string, fileName: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen w-full bg-dark-bg text-zinc-300 font-sans relative overflow-x-hidden flex flex-col items-center">
      
      {/* Background Elements */}
      <div className="fixed top-[-20%] right-[-10%] w-[600px] h-[600px] bg-brand/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-brand-dim rounded-full blur-[100px] pointer-events-none"></div>
      <div className="fixed inset-0 z-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '50px 50px' }}></div>

      <div className="relative z-10 w-full max-w-5xl px-6 py-12 flex flex-col items-center">
        
        {/* Top Navigation */}
        <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
           <button 
            onClick={() => setShowHistory(true)}
            className="p-2 rounded-full bg-white/5 text-zinc-400 hover:text-brand hover:bg-white/10 transition-all group relative"
            title="歷史紀錄"
          >
            <History className="w-6 h-6" />
             <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 text-xs text-white bg-black/80 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">歷史紀錄</span>
          </button>
          <button 
            onClick={() => setShowGuide(true)}
            className="p-2 rounded-full bg-white/5 text-zinc-400 hover:text-brand hover:bg-white/10 transition-all group relative"
            title="使用指南"
          >
            <HelpCircle className="w-6 h-6" />
            <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 text-xs text-white bg-black/80 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">使用指南</span>
          </button>
        </div>

        {/* Header */}
        <div className="w-full flex flex-col items-center mb-12 text-center">
          <div className="relative mb-6 group">
             <div className="absolute inset-0 bg-brand rounded-full blur-[40px] opacity-20 group-hover:opacity-30 transition-opacity duration-500"></div>
             <img src="https://i.meee.com.tw/wkmpdDv.png" alt="Gamer AI Logo" className="relative w-24 h-24 object-contain drop-shadow-2xl z-10"/>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-3">
            GAMER <span className="text-brand">AI VOICE</span>
          </h1>
          <p className="text-zinc-500 text-sm md:text-base">Next-gen Transcription & Smart Analysis</p>
        </div>

        {/* API Key Section */}
        <div className={`w-full max-w-2xl mb-8 transition-all duration-300 ${!apiKey ? 'animate-bounce-subtle' : ''}`}>
             <div className={`backdrop-blur-xl bg-dark-card border ${!apiKey ? 'border-brand/50 ring-2 ring-brand/10' : 'border-white/5'} rounded-2xl overflow-hidden transition-all hover:border-white/10`}>
                <button onClick={() => setShowSettings(!showSettings)} className="w-full px-6 py-4 flex items-center justify-between text-left">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${apiKey ? 'bg-brand/20 text-brand' : 'bg-zinc-800 text-zinc-500'}`}>
                            <Key className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-white">API Configuration</h3>
                            <p className="text-[10px] text-zinc-500">{apiKey ? '• Connected' : '• Disconnected'}</p>
                        </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-zinc-600 transition-transform ${showSettings ? 'rotate-90' : ''}`} />
                </button>
                {(showSettings || !apiKey) && (
                    <div className="px-6 pb-6 pt-0">
                        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste Google Gemini API Key..." className="w-full px-4 py-3 bg-black/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand outline-none font-mono text-sm mb-2"/>
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">Get API Key →</a>
                    </div>
                )}
             </div>
        </div>

        {/* Upload & Process Area */}
        <div className="w-full relative mb-12">
          {!file ? (
             <div className={`relative group rounded-[2rem] border-2 border-dashed transition-all duration-300 ease-out overflow-hidden cursor-pointer ${dragActive ? 'border-brand bg-brand/5 scale-[1.01]' : 'border-zinc-800 bg-zinc-900/30 hover:border-brand/50 hover:bg-zinc-900/50'}`}
                onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop} onClick={() => !isProcessing && fileInputRef.current?.click()}
             >
                <input ref={fileInputRef} type="file" className="hidden" accept="audio/*,video/*" onChange={handleChange} disabled={isProcessing} />
                <div className="px-8 py-16 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 mb-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-xl group-hover:scale-110 group-hover:border-brand/30 transition-all duration-300">
                        <Upload className="w-7 h-7 text-zinc-400 group-hover:text-brand transition-colors" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Upload Audio File</h3>
                    <p className="text-zinc-500 text-sm">MP3, WAV, M4A, MP4 supported</p>
                </div>
             </div>
          ) : (
             <div className="w-full max-w-lg mx-auto animate-in fade-in zoom-in duration-300">
                <div className="flex items-center gap-4 p-4 bg-black/40 border border-zinc-800 rounded-2xl mb-6">
                    <div className="w-10 h-10 rounded-lg bg-brand flex items-center justify-center text-black shadow-[0_0_10px_rgba(204,255,0,0.4)]">
                        <Activity className="w-5 h-5" />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                        <h4 className="text-white text-sm font-bold truncate">{file.name}</h4>
                        <p className="text-brand text-xs font-mono">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    {!isProcessing && (
                        <button onClick={(e) => { e.stopPropagation(); setFile(null); setTranscript(''); setSummary(''); }} className="p-2 text-zinc-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                            <Scissors className="w-4 h-4" />
                        </button>
                    )}
                </div>

                <div className="mb-6">
                    <AudioVisualizer isProcessing={isProcessing} />
                    {isProcessing && (
                        <div className="mt-4 space-y-2">
                            <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                                <div className="h-full bg-brand transition-all duration-300 shadow-[0_0_10px_#ccff00]" style={{ width: `${progressPercent}%` }}></div>
                            </div>
                            <div className="flex justify-between items-center font-mono text-[10px]">
                                <span className="text-brand animate-pulse">&gt; {progressStatus}</span>
                                <span className="text-white">{progressPercent}%</span>
                            </div>
                        </div>
                    )}
                </div>

                {!isProcessing && !transcript && (
                     <button onClick={processAndTranscribe} className="w-full py-3 rounded-xl bg-brand text-black font-bold text-base hover:bg-brand-hover hover:shadow-[0_0_20px_rgba(204,255,0,0.4)] transition-all flex items-center justify-center gap-2">
                         <Zap className="w-5 h-5 fill-black" /> Start Transcription
                     </button>
                )}
             </div>
          )}
          {error && (
            <div className="mt-4 max-w-lg mx-auto p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 flex items-center gap-3 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> <p>{error}</p>
            </div>
          )}
        </div>

        {/* Results Area (Tabs) */}
        {(transcript || summary) && (
            <div className="w-full animate-in slide-in-from-bottom-8 duration-700">
                <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
                    <button 
                        onClick={() => setActiveTab('transcript')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition-all ${activeTab === 'transcript' ? 'bg-zinc-100 text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]' : 'bg-white/5 text-zinc-400 hover:bg-white/10'}`}
                    >
                        <FileText className="w-4 h-4" /> 逐字稿 (Transcript)
                    </button>
                    <button 
                        onClick={() => setActiveTab('summary')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition-all ${activeTab === 'summary' ? 'bg-brand text-black shadow-[0_0_15px_rgba(204,255,0,0.4)]' : 'bg-white/5 text-zinc-400 hover:bg-white/10'}`}
                    >
                        <Sparkles className="w-4 h-4" /> AI 智慧摘要
                    </button>
                </div>

                <div className="relative rounded-3xl overflow-hidden bg-zinc-900/50 backdrop-blur-md border border-white/5 shadow-2xl min-h-[500px] flex flex-col">
                    
                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center justify-between px-6 py-4 bg-white/5 border-b border-white/5 gap-4">
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full shadow-[0_0_8px] ${activeTab === 'summary' ? 'bg-brand shadow-brand' : 'bg-white shadow-white'}`}></div>
                            <h3 className="font-bold text-white tracking-wide">
                                {activeTab === 'transcript' ? 'Full Transcript' : isSummarizing ? 'Generating Analysis...' : 'Smart Analysis Result'}
                            </h3>
                        </div>
                        
                        <div className="flex items-center gap-2">
                             {/* Tools for Transcript */}
                             {activeTab === 'transcript' && (
                                <>
                                  <button onClick={() => setShowFindReplace(!showFindReplace)} className={`p-2 rounded-lg transition-all ${showFindReplace ? 'bg-brand text-black' : 'bg-white/5 hover:bg-white/20 text-white'}`} title="搜尋與取代">
                                     <Search className="w-4 h-4" />
                                  </button>
                                </>
                             )}

                             {/* Translation Tool */}
                             <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
                                <Globe className="w-4 h-4 text-zinc-400 ml-2" />
                                <select 
                                  value={targetLang}
                                  onChange={(e) => setTargetLang(e.target.value)}
                                  className="bg-transparent text-xs text-white border-none outline-none cursor-pointer py-1"
                                >
                                  <option value="English" className="bg-zinc-800">English</option>
                                  <option value="Japanese" className="bg-zinc-800">日本語</option>
                                  <option value="Traditional Chinese" className="bg-zinc-800">繁體中文</option>
                                  <option value="Simplified Chinese" className="bg-zinc-800">简体中文</option>
                                  <option value="Korean" className="bg-zinc-800">한국어</option>
                                </select>
                                <button 
                                  onClick={handleTranslate} 
                                  disabled={isTranslating}
                                  className="px-2 py-1 rounded bg-brand/10 hover:bg-brand text-brand hover:text-black text-xs font-bold transition-all disabled:opacity-50"
                                >
                                  {isTranslating ? <Loader2 className="w-3 h-3 animate-spin"/> : '翻譯'}
                                </button>
                             </div>

                             <div className="w-px h-4 bg-white/10 mx-1"></div>

                             <button onClick={() => downloadFile(activeTab === 'transcript' ? transcript : summary, `${activeTab}_${file?.name}.txt`)} className="p-2 rounded-lg bg-white/5 hover:bg-white/20 text-white transition-all" title="Download">
                                 <Download className="w-4 h-4" />
                             </button>
                             <button onClick={() => copyToClipboard(activeTab === 'transcript' ? transcript : summary)} className="p-2 rounded-lg bg-white/5 hover:bg-white/20 text-white transition-all" title="Copy">
                                 <Copy className="w-4 h-4" />
                             </button>
                        </div>
                    </div>

                    {/* Find & Replace Bar */}
                    {showFindReplace && activeTab === 'transcript' && (
                      <div className="px-6 py-2 bg-black/40 border-b border-white/5 flex items-center gap-2 animate-in slide-in-from-top-2">
                        <input value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="尋找..." className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white outline-none focus:border-brand w-32" />
                        <span className="text-zinc-500 text-xs">→</span>
                        <input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="取代為..." className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white outline-none focus:border-brand w-32" />
                        <button onClick={handleFindReplace} className="px-3 py-1 bg-brand text-black rounded text-xs font-bold hover:bg-brand-hover">執行取代</button>
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 relative flex flex-col min-h-0">
                        {activeTab === 'transcript' ? (
                            <textarea 
                                value={transcript}
                                onChange={(e) => {
                                    setTranscript(e.target.value);
                                    // Optional: Auto-save to history on change after delay could be added here
                                }}
                                className="flex-1 w-full h-full bg-transparent p-8 font-mono text-sm text-zinc-300 leading-relaxed resize-none outline-none focus:bg-white/[0.02] transition-colors custom-scrollbar placeholder-zinc-700"
                                placeholder="等待轉錄或是貼上文字..."
                                spellCheck={false}
                            />
                        ) : (
                            <div className="flex flex-col h-full">
                                {/* Mode Switcher for Summary */}
                                <div className="px-6 py-3 border-b border-white/5 bg-black/20 flex flex-wrap gap-2">
                                    {[
                                        { id: 'FINANCE', icon: TrendingUp, label: '財經投資' },
                                        { id: 'MEETING', icon: Briefcase, label: '商務會議' },
                                        { id: 'LECTURE', icon: GraduationCap, label: '課程講座' },
                                        { id: 'GENERAL', icon: LayoutList, label: '通用總結' },
                                    ].map((mode) => (
                                        <button
                                            key={mode.id}
                                            disabled={isSummarizing}
                                            onClick={() => generateSummary(transcript, mode.id as SummaryMode)}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${currentMode === mode.id ? 'bg-brand/10 border-brand text-brand' : 'bg-transparent border-transparent text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}
                                        >
                                            <mode.icon className="w-3 h-3" /> {mode.label}
                                        </button>
                                    ))}
                                </div>
                                
                                <div className="p-8 flex-1 max-h-[55vh] overflow-y-auto custom-scrollbar">
                                    {isSummarizing ? (
                                        <div className="h-full flex flex-col items-center justify-center space-y-4 text-zinc-500">
                                            <Loader2 className="w-8 h-8 animate-spin text-brand" />
                                            <p className="animate-pulse text-sm">Gemini is analyzing context...</p>
                                        </div>
                                    ) : summary ? (
                                        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-brand prose-strong:text-white prose-table:border-white/10 prose-th:bg-white/5 prose-th:p-2 prose-td:p-2 prose-td:border-b prose-td:border-white/5">
                                            <pre className="whitespace-pre-wrap font-sans text-zinc-300 leading-7 font-medium">{summary}</pre>
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center gap-6 text-center">
                                            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-2">
                                                <Sparkles className="w-8 h-8 text-zinc-500" />
                                            </div>
                                            <div className="max-w-md space-y-2">
                                                <h4 className="text-xl font-bold text-white">Ready to Analyze</h4>
                                                <p className="text-zinc-500 text-sm">
                                                    AI can automatically detect if this is a financial report, meeting, or lecture, and generate the perfect summary format.
                                                </p>
                                            </div>
                                            <button 
                                                onClick={() => generateSummary(transcript, 'AUTO')}
                                                className="px-8 py-3 rounded-xl bg-brand text-black font-bold hover:bg-brand-hover hover:shadow-[0_0_20px_rgba(204,255,0,0.4)] transition-all flex items-center gap-2"
                                            >
                                                <Sparkles className="w-5 h-5 fill-black" />
                                                Auto-Detect & Generate Summary
                                            </button>
                                            <p className="text-xs text-zinc-600">Or select a specific mode from the toolbar above</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

      </div>
      
      {/* Footer */}
      <footer className="w-full py-8 text-center z-10 relative mt-auto border-t border-white/5 bg-black/20 backdrop-blur-sm">
          <p className="text-xs text-zinc-500 font-medium tracking-wider mb-2">POWERED BY GOOGLE GEMINI 3 FLASH API</p>
          <p className="text-[10px] text-zinc-600 font-mono">{todayDate}</p>
      </footer>

      {/* Guide Modal */}
      {showGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowGuide(false)}></div>
          <div className="relative bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-brand" /> 使用指南
              </h3>
              <button onClick={() => setShowGuide(false)} className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">1</div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200">設定 API Key</h4>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                      請先至 Google AI Studio 申請免費的 API Key，並貼上至設定欄位。
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">2</div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200">上傳音訊檔案</h4>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                      支援 MP3, WAV, M4A, MP4 等格式。長音檔會自動分段處理，無需擔心長度限制。
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">3</div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200">等待轉錄與校正</h4>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                      AI 會自動辨識講者並加上時間軸。過程中請勿關閉視窗。
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">4</div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200">生成智慧摘要 (4種模式)</h4>
                    <div className="text-xs text-zinc-500 mt-1 leading-relaxed space-y-1">
                      <p><span className="text-brand">📈 財經模式</span>：個股清單、市場趨勢、關鍵數據。</p>
                      <p><span className="text-brand">💼 會議模式</span>：會議主旨、決策事項、待辦清單。</p>
                      <p><span className="text-brand">🎓 講座模式</span>：核心觀念、專有名詞、考試重點。</p>
                      <p><span className="text-brand">📝 通用模式</span>：內容大意、金句收錄。</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Developer Section */}
              <div className="mt-6 pt-6 border-t border-white/10">
                 <div className="flex items-start gap-3 bg-white/5 p-4 rounded-xl border border-white/5">
                    <div className="p-2 bg-zinc-800 rounded-lg shrink-0">
                        <User className="w-5 h-5 text-brand" />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-white mb-1">關於 Gamer AI Voice</h4>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                            本工具由 <strong>Gamer</strong> 開發，專為 Podcast 聽眾、會議記錄者與學生設計。利用 AI 技術將音檔（Podcast / 會議記錄 / 課程講座）快速轉錄為逐字稿，並提供多種場景的重點摘要，協助您高效整理資訊，大幅提升學習與工作效率。
                        </p>
                    </div>
                 </div>
              </div>

            </div>
            <div className="p-4 bg-black/20 border-t border-white/5 text-center">
              <button onClick={() => setShowGuide(false)} className="px-6 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold transition-colors">
                開始使用
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowHistory(false)}></div>
          <div className="relative bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
             <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-brand" /> 歷史紀錄 (最近 5 筆)
              </h3>
              <button onClick={() => setShowHistory(false)} className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 custom-scrollbar">
                {history.length === 0 ? (
                    <div className="text-center py-10 text-zinc-500">
                        <p>目前沒有歷史紀錄</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {history.map((item) => (
                            <div key={item.id} className="bg-white/5 border border-white/5 hover:border-brand/30 rounded-xl p-4 transition-all group">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h4 className="text-white font-bold text-sm mb-1">{item.fileName}</h4>
                                        <p className="text-zinc-500 text-[10px]">{new Date(item.timestamp).toLocaleString()}</p>
                                    </div>
                                    <button onClick={(e) => deleteHistoryItem(item.id, e)} className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="text-zinc-400 text-xs line-clamp-2 mb-3 font-mono">
                                    {item.transcript.substring(0, 100)}...
                                </div>
                                <button onClick={() => loadFromHistory(item)} className="w-full py-2 rounded-lg bg-zinc-800 hover:bg-brand hover:text-black text-zinc-300 text-xs font-bold transition-all flex items-center justify-center gap-2">
                                    <RotateCcw className="w-3 h-3" /> 載入紀錄
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;