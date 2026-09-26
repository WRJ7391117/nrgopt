"""Two real connections against the named local validation container only.
Run after migrations: python3 tests/intelligence-budget-concurrency.py
No provider calls. Removes only the randomly generated test owner's rows.
"""
import concurrent.futures
import subprocess
import time
import uuid

BASE = ['docker', 'exec', '-i', 'supabase_db_nrgopt-g1-validation',
        'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1']
owner = str(uuid.uuid4())


def sql(statement):
    result = subprocess.run(BASE, input=statement, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


try:
    sql(f"insert into auth.users(id) values ('{owner}'); "
        "insert into public.intelligence_provider_configs(owner_id,capability,provider,endpoint,model,currency,budget_limit_micro,api_key_ciphertext) "
        f"values ('{owner}','analysis','deepseek','https://api.deepseek.com','fixture','CNY',10000000,repeat('x',24));")
    for same_key, amount in [(False, 6000000), (True, 1000000)]:
        sql(f"delete from public.intelligence_budget_reservations where owner_id='{owner}'; "
            f"update public.intelligence_provider_configs set budget_reserved_micro=0 where owner_id='{owner}';")
        holder = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            holder.stdin.write(f"begin; select 1 from public.intelligence_provider_configs where owner_id='{owner}' for update;\n")
            holder.stdin.flush()
            assert holder.stdout.readline().strip() == '1', 'row lock not acquired'
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                tasks = [pool.submit(sql, f"select public.reserve_intelligence_budget('{owner}',null,'extraction','CNY','test-{0 if same_key else i}',{amount});") for i in range(2)]
                try:
                    for _ in range(50):
                        waiting = sql("select count(*) from pg_stat_activity where wait_event_type='Lock' "
                                      f"and query like 'select public.reserve_intelligence_budget(''{owner}''%';")
                        if waiting == '2':
                            break
                        time.sleep(.05)
                    else:
                        raise AssertionError('both requests must wait on the row lock')
                finally:
                    holder.stdin.write('commit;\n')
                    holder.stdin.close()
                    holder.wait(timeout=5)
                ids = [task.result() for task in tasks]
            if same_key:
                assert ids[0] and ids[0] == ids[1], 'same key must return the same reservation'
            else:
                assert sum(bool(value) for value in ids) == 1, 'two six-yuan reservations must not exceed ten yuan'
            assert sql(f"select count(*)||'|'||sum(reserved_micro) from public.intelligence_budget_reservations where owner_id='{owner}';") == f'1|{amount}'
        finally:
            if holder.poll() is None:
                holder.kill()
                holder.wait()
    print('PASS: concurrent cap enforcement and same-key reservation replay')
finally:
    sql(f"delete from public.intelligence_budget_reservations where owner_id='{owner}'; delete from auth.users where id='{owner}';")
