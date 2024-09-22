import { Injectable, Logger } from '@nestjs/common';
import { TxEntity } from '../../entities/tx.entity';
import {
  DataSource,
  EntityManager,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  payments,
  Transaction,
  TxInput,
  TxOutput,
  crypto,
} from 'bitcoinjs-lib';
import { TxOutEntity } from '../../entities/txOut.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Constants } from '../../common/constants';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { CatTxError } from '../../common/exceptions';
import { parseTokenInfo, TaprootPayment } from '../../common/utils';
import { BlockHeader, TokenInfo } from '../../common/types';
import { TokenMintEntity } from '../../entities/tokenMint.entity';
// import { getGuardContractInfo } from '@cat-protocol/cat-smartcontracts';
import { LRUCache } from 'lru-cache';
import {TokenStatisticsEntity} from "../../entities/tokenstatistics.entity";

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  private readonly GUARD_PUBKEY: string;
  private readonly TRANSFER_GUARD_SCRIPT_HASH: string;

  private static readonly taprootPaymentCache = new LRUCache<
    string,
    { pubkey: Buffer; redeemScript: Buffer }
  >({
    max: 10000,
    ttlAutopurge: true,
  });

  constructor(
    private dataSource: DataSource,
    @InjectRepository(TokenStatisticsEntity)
    private tokenStatisticsEntityRepository: Repository<TokenStatisticsEntity>,
  ) {
    // const guardContractInfo = getGuardContractInfo();
    // this.GUARD_PUBKEY = guardContractInfo.tpubkey;
    // this.TRANSFER_GUARD_SCRIPT_HASH =
    //   guardContractInfo.contractTaprootMap.transfer.contractScriptHash;
    // this.logger.log(`guard xOnlyPubKey = ${this.GUARD_PUBKEY}`);
    // this.logger.log(
    //   `guard transferScriptHash = ${this.TRANSFER_GUARD_SCRIPT_HASH}`,
    // );
  }

  async onModuleInit() {
    await this.countCat();
    this.logger.log('start job');
  }


  /**
   */
  private async countCat() {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    const task = async () => {
      try {
        console.log("job run ...");
        const sql = `select * from token_info where token_pubkey is not null;`;
        const history = await queryRunner.manager.query(sql, []);



        console.log("start get token mint amount...");

        const mintSql = 'select token_pubkey as tokenkey,SUM(token_amount)  as amount  from token_mint group by token_pubkey'
        const getTokenMintTotal = await queryRunner.manager.query(mintSql, []);

        console.log("start get token holders amount...");

        const holderSql = 'select xonly_pubkey as tokenkey,COUNT(DISTINCT owner_pkh) as holders from tx_out where spend_txid is null  GROUP BY xonly_pubkey ;';
        const tokenHolder = await queryRunner.manager.query(holderSql, []);

        const tokenHolders = new Map();
        for(var i =0;i < getTokenMintTotal.length;i++){
          var tokenInfo = getTokenMintTotal[i]
          tokenHolders.set(tokenInfo.tokenkey,tokenInfo);
        }

        for(var i =0;i < tokenHolder.length;i++){
          var tHolder = tokenHolder[i]
          var tokenInfo = tokenHolders.get(tHolder.tokenkey)
          const newToken = {
            ...tokenInfo,
            holders: tHolder.holders
          };
          tokenHolders.set(tHolder.tokenkey,newToken);
        }


        console.log("start insert ...");

        for(var i =0;i < history.length;i++){
           var tokenInfo = history[i]

          const tokenHolderMint = tokenHolders.get(tokenInfo.token_pubkey);
           if (!tokenHolderMint){
             console.log('get',tokenHolderMint,"tokenInfo.token_pubkey",tokenInfo.token_pubkey)
           }
           var mint = 0;
          var holders = 0;
            if (tokenHolderMint) {
              mint = tokenHolderMint.amount;
              if (tokenHolderMint.holders){
                holders = tokenHolderMint.holders;
              }
            }

           const entiry = new  TokenStatisticsEntity();
          entiry.tokenId = tokenInfo.token_id;
          entiry.tokenName = tokenInfo.raw_info.name;
          entiry.max = tokenInfo.raw_info.max;
          entiry.mint = mint;
          entiry.holders = holders;
          await this.tokenStatisticsEntityRepository.save(entiry);
        }
        console.log("job end ...");

      } catch (error) {
        console.error('job error:', error);
      }
    };

    const intervalId = setInterval(task, 600000);
  }


}
