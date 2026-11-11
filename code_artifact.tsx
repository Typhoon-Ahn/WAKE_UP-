import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, collection, onSnapshot, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Sun, Plus, Trash2, Coffee, Trophy, Moon, AlertCircle, User, Calendar, X } from 'lucide-react';

// ============================================================================
// 1. Firebase Initialization (Outside Component)
// ============================================================================
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { projectId: "demo-project" }; // Fallback for local testing without config

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'routine-challenge-app';

// ============================================================================
// 2. Helper Functions
// ============================================================================
// 로컬 YYYY-MM-DD 포맷 반환 (시간대 고려)
const formatLocalYMD = (dateObj) => {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getTodayStr = () => {
  const d = new Date();
  // 오전 4시 30분 이전이라면, 논리적으로는 전날로 처리 (4시 30분 리셋)
  if (d.getHours() < 4 || (d.getHours() === 4 && d.getMinutes() < 30)) {
    d.setDate(d.getDate() - 1);
  }
  return formatLocalYMD(d);
};

const formatTime = (ts) => {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('ko-KR', {
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: true
  });
};

// 7일 트래커 계산 (2026-11-11 기준)
const getTrackerDates = (todayStr) => {
  const startDate = new Date(2026, 10, 11); // 2026-11-11
  const todayParts = todayStr.split('-').map(Number);
  const todayDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
  
  const diffDays = Math.floor((todayDate - startDate) / (1000 * 60 * 60 * 24));
  
  const dates = [];
  if (diffDays < 7) {
    // 시작일(11/11)로부터 7일 미만이면 11/11 ~ 11/17 고정 출력
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 10, 11 + i);
      dates.push(formatLocalYMD(d));
    }
  } else {
    // 7일 이상 지났다면 오늘 기준 최근 7일 슬라이딩
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - i);
      dates.push(formatLocalYMD(d));
    }
  }
  return dates;
};

// 11/11 ~ 12/11 (총 31일) 달력 배열 생성
const getCalendarDates = () => {
  const dates = [];
  for (let i = 0; i < 31; i++) {
    const d = new Date(2026, 10, 11 + i);
    dates.push(formatLocalYMD(d));
  }
  return dates;
};

// 특정 날짜의 상태 구하기 로직 (성공/실패/빈값)
const getStatusForDate = (participant, dateStr, todayStr) => {
  // 미래 날짜는 아직 오지 않았으므로 무조건 빈칸 처리 (미리 초록불 방지)
  if (dateStr > todayStr) return 'empty';

  const log = participant.logs?.[dateStr];
  const status = log?.status; 
  
  const dParts = dateStr.split('-').map(Number);
  const d = new Date(dParts[0], dParts[1] - 1, dParts[2]);
  const dayOfWeek = d.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  // 성공 조건: 
  // 1) 기록상 success, 2) 예전 기록 포맷(타임스탬프만 있는경우) 
  // 3) 주말 자동성공 (주말옵션 해제 & 이번이 주말 & 다른 기록이 없는 상태)
  const isWeekendExcludedSuccess = !participant.includeWeekends && isWeekend && !status;
  
  if (status === 'success' || (!status && typeof log === 'number') || isWeekendExcludedSuccess) {
    return 'success';
  } else if (status === 'fail') {
    return 'fail';
  }
  return 'empty';
};

// ============================================================================
// 3. Main React Component
// ============================================================================
export default function RoutineChallengeApp() {
  const [user, setUser] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newAvatarType, setNewAvatarType] = useState('default');
  const [newCustomImage, setNewCustomImage] = useState(null);
  const [newTargetHour, setNewTargetHour] = useState('09');
  const [newTargetMinute, setNewTargetMinute] = useState('00');
  const [newIncludeWeekends, setNewIncludeWeekends] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 기록 모달을 위한 상태
  const [selectedParticipantForModal, setSelectedParticipantForModal] = useState(null);

  const todayStr = getTodayStr();
  const trackerDates = useMemo(() => getTrackerDates(todayStr), [todayStr]);
  const calendarDates = useMemo(() => getCalendarDates(), []);

  // --------------------------------------------------------------------------
  // Firebase Auth Setup
  // --------------------------------------------------------------------------
  useEffect(() => {
    let unsubscribeAuth;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
        setErrorMsg("인증에 실패했습니다. 페이지를 새로고침 해주세요.");
      }
    };

    initAuth();
    
    unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    return () => {
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, []);

  // --------------------------------------------------------------------------
  // Firebase Data Fetching
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;

    const participantsRef = collection(db, 'artifacts', appId, 'public', 'data', 'participants');
    
    const unsubscribeData = onSnapshot(participantsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setParticipants(data);
      setLoading(false);
    }, (err) => {
      console.error("Firestore Subscribe Error:", err);
      setErrorMsg("데이터를 불러오는데 실패했습니다.");
      setLoading(false);
    });

    return () => unsubscribeData();
  }, [user]);

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------
  const handleAddParticipant = async (e) => {
    e.preventDefault();
    if (!newParticipantName.trim() || !user || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const avatarToSave = newAvatarType === 'custom' && newCustomImage ? newCustomImage : 'default';
      const participantsRef = collection(db, 'artifacts', appId, 'public', 'data', 'participants');
      await addDoc(participantsRef, {
        name: newParticipantName.trim(),
        avatar: avatarToSave,
        targetTime: `${newTargetHour}:${newTargetMinute}`,
        includeWeekends: newIncludeWeekends,
        logs: {}, 
        createdAt: Date.now(),
        addedBy: user.uid
      });
      setNewParticipantName('');
      setNewAvatarType('default');
      setNewCustomImage(null);
      setNewTargetHour('09');
      setNewTargetMinute('00');
      setNewIncludeWeekends(false);
    } catch (err) {
      console.error("Add Error:", err);
      setErrorMsg("작가를 추가하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 150; 
        const MAX_HEIGHT = 150; 
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        setNewCustomImage(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleWakeUp = async (participant) => {
    if (!user) return;
    
    try {
      const targetStr = participant.targetTime || '09:00';
      const [tHours, tMins] = targetStr.split(':').map(Number);
      const now = new Date();
      
      // 4시 30분 리셋을 적용한 '논리적 오늘'의 날짜 구하기
      const logicalTodayDate = new Date();
      if (now.getHours() < 4 || (now.getHours() === 4 && now.getMinutes() < 30)) {
        logicalTodayDate.setDate(logicalTodayDate.getDate() - 1);
      }
      
      // 당일 목표시간 + 10분 설정 (논리적 오늘 날짜 기준)
      const targetDate = new Date(logicalTodayDate);
      targetDate.setHours(tHours, tMins + 10, 0, 0);

      const status = now.getTime() <= targetDate.getTime() ? 'success' : 'fail';
      const timestamp = now.getTime();

      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'participants', participant.id);
      await updateDoc(docRef, {
        [`logs.${todayStr}`]: { time: timestamp, status: status }
      });
    } catch (err) {
      console.error("Wake Up Error:", err);
      setErrorMsg("기상 시간을 기록하지 못했습니다.");
    }
  };

  const handleDelete = async (participantId) => {
    if (!user) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'participants', participantId);
      await deleteDoc(docRef);
    } catch (err) {
      console.error("Delete Error:", err);
    }
  };

  // --------------------------------------------------------------------------
  // Data Processing (Sorting)
  // --------------------------------------------------------------------------
  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      const logA = a.logs?.[todayStr];
      const logB = b.logs?.[todayStr];
      const timeA = logA?.time || (typeof logA === 'number' ? logA : 0);
      const timeB = logB?.time || (typeof logB === 'number' ? logB : 0);

      if (timeA && timeB) return timeA - timeB;
      if (timeA) return -1;
      if (timeB) return 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }, [participants, todayStr]);

  let currentRank = 1;

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#FFF4E6] font-sans selection:bg-[#FFB5A7] selection:text-white pb-20 relative">
      
      {/* Header */}
      <header className="pt-12 pb-8 px-6 text-center">
        <div className="inline-flex items-center justify-center space-x-2 bg-white px-6 py-3 rounded-full border-2 border-[#FFA07A] shadow-[4px_4px_0px_#FFA07A] mb-4">
          <Sun className="text-[#FF8FAB] w-6 h-6 animate-[spin_10s_linear_infinite]" />
          <h1 className="text-xl md:text-2xl font-black text-[#4A4A4A]">태풍이의 기상 인증 시스템</h1>
          <Coffee className="text-[#A0522D] w-6 h-6" />
        </div>
        <p className="text-[#7A7A7A] font-medium text-sm md:text-base mt-2 bg-white/50 inline-block px-4 py-1 rounded-full">
          오늘의 날짜: {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4">
        
        {/* Error Message */}
        {errorMsg && (
          <div className="mb-6 bg-red-100 border-2 border-red-300 text-red-700 px-4 py-3 rounded-2xl flex items-center shadow-[4px_4px_0px_#FCA5A5]">
            <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />
            <p className="font-bold text-sm">{errorMsg}</p>
            <button onClick={() => setErrorMsg('')} className="ml-auto font-bold opacity-50 hover:opacity-100">X</button>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 opacity-70">
            <Sun className="w-12 h-12 text-[#FFA07A] animate-bounce mb-4" />
            <p className="text-[#4A4A4A] font-bold text-lg">작가님들 데이터를 불러오는 중...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedParticipants.length === 0 ? (
              <div className="bg-white border-2 border-[#FFDDA1] shadow-[6px_6px_0px_#FFDDA1] rounded-3xl p-8 text-center text-[#7A7A7A]">
                <Moon className="w-12 h-12 mx-auto text-[#FFDDA1] mb-4" />
                <p className="font-bold text-lg text-[#4A4A4A]">아직 참여한 작가님이 없어요!</p>
                <p className="text-sm mt-1">아래에서 작가님의 이름을 추가해주세요.</p>
              </div>
            ) : (
              sortedParticipants.map((participant) => {
                const logToday = participant.logs?.[todayStr];
                const isWokeUp = !!logToday;
                const wokeUpTime = logToday?.time || (typeof logToday === 'number' ? logToday : null);
                const wokeUpStatus = logToday?.status; 
                
                let badge = null;
                if (isWokeUp) {
                  if (wokeUpStatus === 'success' || !wokeUpStatus) {
                    if (currentRank === 1) badge = "🥇 1등";
                    else if (currentRank === 2) badge = "🥈 2등";
                    else if (currentRank === 3) badge = "🥉 3등";
                    else badge = "🎉 기상 성공";
                    currentRank++; 
                  } else if (wokeUpStatus === 'fail') {
                    badge = "⏰ 지각";
                  }
                }

                return (
                  <div 
                    key={participant.id} 
                    className={`relative flex flex-col p-5 rounded-2xl border-2 transition-all duration-300 ${
                      isWokeUp 
                        ? (wokeUpStatus === 'fail' ? 'bg-white border-red-200 shadow-[4px_4px_0px_#FECACA]' : 'bg-white border-[#B2F5EA] shadow-[4px_4px_0px_#B2F5EA]')
                        : 'bg-white border-[#E2E8F0] shadow-[4px_4px_0px_#E2E8F0]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-4">
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center text-3xl border-2 overflow-hidden ${
                          isWokeUp ? (wokeUpStatus === 'fail' ? 'bg-red-50 border-red-200' : 'bg-[#E6FFFA] border-[#81E6D9]') : 'bg-gray-100 border-gray-300'
                        }`}>
                          {participant.avatar?.startsWith('data:image') ? (
                            <img src={participant.avatar} alt="프로필" className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-8 h-8 text-gray-400" />
                          )}
                        </div>
                        
                        <div>
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            <h2 className="text-lg font-black text-[#2D3748]">{participant.name}</h2>
                            <button 
                              onClick={() => setSelectedParticipantForModal(participant)}
                              className="flex items-center px-2 py-1 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors border-2 border-purple-200 shadow-[2px_2px_0px_#E9D8FD] active:shadow-none active:translate-y-[2px]"
                            >
                              <Calendar className="w-3.5 h-3.5 mr-1" />
                              <span className="text-xs font-bold">기록</span>
                            </button>
                            {isWokeUp && badge && (
                              <span className={`text-xs font-bold px-2 py-1 rounded-full border ${wokeUpStatus === 'fail' ? 'bg-red-100 text-red-700 border-red-300' : 'bg-yellow-100 text-yellow-700 border-yellow-300'}`}>
                                {badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 font-bold mb-1 mt-1">
                            목표 시간: 오전 {participant.targetTime || '09:00'} (10분 유예) {participant.includeWeekends ? '' : '• 주말 제외'}
                          </p>
                          {isWokeUp ? (
                            <p className={`text-sm font-bold flex items-center ${wokeUpStatus === 'fail' ? 'text-red-500' : 'text-[#319795]'}`}>
                              <Trophy className="w-3 h-3 mr-1" />
                              {formatTime(wokeUpTime)} 인증!
                            </p>
                          ) : (
                            <p className="text-sm font-semibold text-gray-400 flex items-center">
                              <Moon className="w-3 h-3 mr-1" />
                              아직 꿈나라 여행 중 💤
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2">
                        {!isWokeUp ? (
                          <button
                            onClick={() => handleWakeUp(participant)}
                            className="bg-[#FF8FAB] text-white font-bold py-2 px-4 rounded-xl border-2 border-[#FF5E84] shadow-[0_4px_0px_#FF5E84] hover:translate-y-[2px] hover:shadow-[0_2px_0px_#FF5E84] active:translate-y-[4px] active:shadow-none transition-all whitespace-nowrap"
                          >
                            기상! ☀️
                          </button>
                        ) : (
                          <div className="px-4 py-2 bg-gray-100 text-gray-500 font-bold rounded-xl border-2 border-gray-200 text-sm whitespace-nowrap">
                            {wokeUpStatus === 'fail' ? '지각 기록' : '완료됨'}
                          </div>
                        )}
                        
                        <button 
                          onClick={() => handleDelete(participant.id)}
                          className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                          title="작가 삭제"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* 7 Days Tracker */}
                    <div className="mt-2 pt-3 border-t-2 border-dashed border-gray-200">
                      <div className="flex items-center justify-between text-xs font-bold text-gray-400 mb-2">
                        <span>7일 연속 트래커</span>
                        <div className="flex space-x-2 text-[10px]">
                          <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-green-400 mr-1"></span>성공/주말</span>
                          <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-red-400 mr-1"></span>실패</span>
                        </div>
                      </div>
                      
                      <div className="flex space-x-1 sm:space-x-2">
                        {trackerDates.map(date => {
                          const status = getStatusForDate(participant, date, todayStr);
                          
                          let blockColor = 'bg-gray-100 border-gray-200'; 
                          if (status === 'success') {
                            blockColor = 'bg-green-400 border-green-500 shadow-[0_2px_0px_#22c55e]';
                          } else if (status === 'fail') {
                            blockColor = 'bg-red-400 border-red-500 shadow-[0_2px_0px_#ef4444]';
                          }
                          
                          // 날짜 포맷 (예: 11/11) 및 요일
                          const dParts = date.split('-').map(Number);
                          const monthDay = `${dParts[1]}/${dParts[2]}`;
                          const dayObj = new Date(dParts[0], dParts[1]-1, dParts[2]);
                          const dayIdx = dayObj.getDay();
                          const days = ['일', '월', '화', '수', '목', '금', '토'];
                          
                          let dayColorClass = 'text-gray-500';
                          if (dayIdx === 0) dayColorClass = 'text-red-500';
                          if (dayIdx === 6) dayColorClass = 'text-blue-500';

                          return (
                            <div key={date} className="flex-1 flex flex-col items-center">
                              <div className={`w-full h-8 rounded-lg border-2 ${blockColor} transition-all`}></div>
                              <div className={`mt-1 text-[10px] font-bold flex flex-col items-center leading-tight ${dayColorClass}`}>
                                <span>{monthDay}</span>
                                <span>({days[dayIdx]})</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Add Participant Form */}
        {!loading && (
          <form 
            onSubmit={handleAddParticipant}
            className="mt-8 bg-white p-5 rounded-3xl border-2 border-[#FFDDA1] shadow-[6px_6px_0px_#FFDDA1] flex flex-col space-y-4"
          >
            <div className="flex items-center justify-between font-bold text-[#4A4A4A]">
              <span>새 작가 등록하기 ✨</span>
            </div>
            
            <div className="flex flex-col space-y-3 mb-2">
              <div className="flex space-x-2 bg-gray-50 p-1.5 rounded-xl w-fit border-2 border-gray-100">
                <button 
                  type="button" 
                  onClick={() => setNewAvatarType('default')} 
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${newAvatarType === 'default' ? 'bg-white text-[#FF8FAB] shadow-[0_2px_0px_#FFDDA1]' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  기본 프로필
                </button>
                <button 
                  type="button" 
                  onClick={() => setNewAvatarType('custom')} 
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${newAvatarType === 'custom' ? 'bg-white text-[#FF8FAB] shadow-[0_2px_0px_#FFDDA1]' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  내 사진 업로드
                </button>
              </div>

              {newAvatarType === 'default' ? (
                <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-xl border-2 border-gray-200">
                  <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center border-2 border-gray-300">
                    <User className="w-7 h-7 text-gray-400" />
                  </div>
                  <p className="text-sm font-bold text-gray-500">깔끔한 기본 프로필이 적용됩니다.</p>
                </div>
              ) : (
                <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleImageUpload} 
                    className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-[#FFDDA1] file:text-[#A0522D] hover:file:bg-[#FFC67D] file:transition-colors file:cursor-pointer w-full" 
                  />
                  {newCustomImage && <img src={newCustomImage} alt="미리보기" className="w-12 h-12 object-cover rounded-full border-2 border-[#FFA07A] shadow-sm flex-shrink-0" />}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
              <input
                type="text"
                placeholder="작가님의 이름"
                value={newParticipantName}
                onChange={(e) => setNewParticipantName(e.target.value)}
                className="flex-1 bg-gray-50 border-2 border-gray-200 rounded-xl px-4 py-3 font-bold text-[#4A4A4A] focus:outline-none focus:border-[#FF8FAB] focus:bg-white transition-colors placeholder:font-medium placeholder:text-gray-400"
                maxLength={10}
              />
              <div className="flex flex-col space-y-2">
                <div className="flex items-center space-x-1 bg-gray-50 border-2 border-gray-200 rounded-xl px-3 py-3 focus-within:border-[#FF8FAB] focus-within:bg-white transition-colors">
                  <span className="text-sm font-bold text-gray-500 whitespace-nowrap mr-1">오전</span>
                  <select
                    value={newTargetHour}
                    onChange={(e) => setNewTargetHour(e.target.value)}
                    className="bg-transparent font-bold text-[#4A4A4A] focus:outline-none cursor-pointer"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={String(i).padStart(2, '0')}>{i}시</option>
                    ))}
                  </select>
                  <span className="font-bold text-gray-400">:</span>
                  <select
                    value={newTargetMinute}
                    onChange={(e) => setNewTargetMinute(e.target.value)}
                    className="bg-transparent font-bold text-[#4A4A4A] focus:outline-none cursor-pointer"
                  >
                    {['00', '10', '20', '30', '40', '50'].map(m => (
                      <option key={m} value={m}>{m}분</option>
                    ))}
                  </select>
                </div>
                
                <label className="flex items-center space-x-2 cursor-pointer ml-1">
                  <input 
                    type="checkbox" 
                    checked={newIncludeWeekends}
                    onChange={(e) => setNewIncludeWeekends(e.target.checked)}
                    className="w-4 h-4 text-[#FF8FAB] rounded focus:ring-[#FF8FAB] accent-[#FF8FAB]"
                  />
                  <span className="text-xs font-bold text-gray-500">주말에도 기상 인증하기</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !newParticipantName.trim()}
                className="bg-[#9F7AEA] text-white p-3 rounded-xl border-2 border-[#805AD5] shadow-[0_4px_0px_#805AD5] hover:translate-y-[2px] hover:shadow-[0_2px_0px_#805AD5] active:translate-y-[4px] active:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center sm:w-16 h-[52px]"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>
          </form>
        )}
      </main>

      {/* 달력 모달 (Calendar Modal) */}
      {selectedParticipantForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] border-4 border-[#FFA07A] shadow-[8px_8px_0px_#FFA07A] p-6 max-w-md w-full relative">
            <button 
              onClick={() => setSelectedParticipantForModal(null)}
              className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200 transition-colors border-2 border-gray-200"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="text-center mb-6 pt-2">
              <div className="flex justify-center mb-2">
                <div className="w-16 h-16 rounded-full border-4 border-[#FF8FAB] overflow-hidden bg-gray-50 flex items-center justify-center">
                  {selectedParticipantForModal.avatar?.startsWith('data:image') ? (
                    <img src={selectedParticipantForModal.avatar} alt="프로필" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-8 h-8 text-gray-400" />
                  )}
                </div>
              </div>
              <h2 className="text-2xl font-black text-[#4A4A4A]">{selectedParticipantForModal.name}님의 기록</h2>
              <p className="text-sm font-bold text-[#FF8FAB] mt-1">11월 11일 ~ 12월 11일</p>
            </div>

            <div className="grid grid-cols-7 gap-2 sm:gap-3 text-center mb-2">
              {['일', '월', '화', '수', '목', '금', '토'].map((day, idx) => {
                let color = 'text-gray-500';
                if (idx === 0) color = 'text-red-500';
                if (idx === 6) color = 'text-blue-500';
                return (
                  <div key={day} className={`font-black text-sm ${color}`}>
                    {day}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-7 gap-2 sm:gap-3">
              {/* 11월 11일(수요일)을 맞추기 위한 빈 칸 (일, 월, 화) */}
              <div className="bg-transparent"></div>
              <div className="bg-transparent"></div>
              <div className="bg-transparent"></div>
              
              {/* 날짜 그리기 (31일치) */}
              {calendarDates.map((dateStr) => {
                const status = getStatusForDate(selectedParticipantForModal, dateStr, todayStr);
                const dayNum = parseInt(dateStr.split('-')[2], 10);
                
                let blockColor = 'bg-gray-50 border-gray-200 text-gray-400'; 
                if (status === 'success') {
                  blockColor = 'bg-green-100 border-green-400 text-green-700 shadow-[2px_2px_0px_#4ade80]';
                } else if (status === 'fail') {
                  blockColor = 'bg-red-100 border-red-400 text-red-700 shadow-[2px_2px_0px_#f87171]';
                }

                return (
                  <div 
                    key={dateStr} 
                    className={`aspect-square rounded-xl border-2 flex items-center justify-center font-bold text-sm sm:text-base transition-all ${blockColor}`}
                  >
                    {dayNum}
                  </div>
                );
              })}
            </div>
            
            <div className="mt-6 flex justify-center space-x-4 text-xs font-bold text-gray-500 bg-gray-50 py-3 rounded-2xl border-2 border-gray-100">
              <span className="flex items-center"><div className="w-3 h-3 rounded-full bg-green-400 mr-2 border border-green-500"></div>성공</span>
              <span className="flex items-center"><div className="w-3 h-3 rounded-full bg-red-400 mr-2 border border-red-500"></div>지각/실패</span>
              <span className="flex items-center"><div className="w-3 h-3 rounded-full bg-gray-200 mr-2 border border-gray-300"></div>대기</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}