import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openWindows, toMinutes, TIMETABLE, type ClassWindow } from '../config.js';

test('toMinutes 正確換算 HH:MM', () => {
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('09:10'), 550);
  assert.equal(toMinutes('23:59'), 1439);
});

test('toMinutes 拒絕格式錯誤的輸入', () => {
  for (const bad of ['9', '24:00', '12:60', '1:2:3', 'ab:cd', '']) {
    assert.throws(() => toMinutes(bad), /時間格式錯誤/, bad);
  }
});

/** 2026-09-16 是週三 */
const wed = (hhmm: string) => new Date(`2026-09-16T${hhmm}:00`);

const timetable: ClassWindow[] = [
  { name: '週三上午', weekday: 3, start: '09:10', end: '12:00' },
  { name: '週三下午', weekday: 3, start: '13:30', end: '15:15', lat: 1, lng: 2 },
  { name: '週四',     weekday: 4, start: '09:10', end: '12:00' },
];

test('openWindows 只回傳今天且正在進行中的時段', () => {
  assert.deepEqual(openWindows(wed('10:00'), timetable).map((w) => w.name), ['週三上午']);
  assert.deepEqual(openWindows(wed('14:00'), timetable).map((w) => w.name), ['週三下午']);
});

test('openWindows 起訖時間皆含端點', () => {
  assert.equal(openWindows(wed('09:10'), timetable).length, 1);
  assert.equal(openWindows(wed('12:00'), timetable).length, 1);
  assert.equal(openWindows(wed('09:09'), timetable).length, 0);
  assert.equal(openWindows(wed('12:01'), timetable).length, 0);
});

test('openWindows 在其他星期或空檔回傳空陣列', () => {
  assert.deepEqual(openWindows(wed('12:30'), timetable), []);
  assert.deepEqual(openWindows(new Date('2026-09-15T10:00:00'), timetable), []); // 週二
});

test('openWindows 可同時回傳多個重疊時段', () => {
  const overlap: ClassWindow[] = [
    { name: 'A', weekday: 3, start: '10:00', end: '11:00' },
    { name: 'B', weekday: 3, start: '10:30', end: '11:30' },
  ];
  assert.deepEqual(openWindows(wed('10:45'), overlap).map((w) => w.name), ['A', 'B']);
});

test('內建 TIMETABLE 的每個時段格式合法且 start <= end', () => {
  for (const w of TIMETABLE) {
    assert.ok(w.weekday >= 0 && w.weekday <= 6, w.name);
    assert.ok(toMinutes(w.start) <= toMinutes(w.end), w.name);
  }
});
