import assert from 'node:assert/strict';
import { TopBar } from './TopBar';
import { MenuIcon } from '../../components/icons';

assert.equal(typeof TopBar, 'function', 'TopBar should be a function component');
assert.equal(typeof MenuIcon, 'function', 'MenuIcon should be a function component');

console.log('TopBar.check.ts ok');
