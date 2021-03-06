import bcrypt from 'bcrypt';
import jsSHA from 'jssha';
import { extendType, nonNull, stringArg } from 'nexus';
import { GraphQLExposableError } from '../../../exposableError';

export const LoginMutation = extendType({
  type: 'Mutation',
  definition(t) {
    t.nonNull.field('login', {
      type: 'LoginResult',
      description:
        '사이트에 로그인합니다. 성공시 로그인 토큰을 반환합니다.',
      args: {
        id: nonNull(
          stringArg({ description: '로그인 ID' })
        ),
        password: nonNull(
          stringArg({ description: '로그인 비밀번호' })
        ),
      },
      async resolve(root, { id, password }, ctx) {
        id = id.trim().toLowerCase();
        if (id.length === 0)
          throw new GraphQLExposableError('Empty id');

        const user = await ctx.db.sSOUser.findUnique({
          where: {
            id,
          },
          include: {
            member: true,
          },
        });

        if (user === null)
          return {
            success: false,
            errorMessage:
              '아이디나 비밀번호가 올바르지 않습니다.',
          };

        let success = false;
        if (user.hashAlgorithm === 'bcrypt') {
          success = await bcrypt.compare(
            password,
            user.password
          );
        } else if (user.hashAlgorithm === 'sha256') {
          const sha256 = new jsSHA('SHA-256', 'TEXT', {
            encoding: 'UTF8',
          });
          sha256.update(password);
          success =
            sha256.getHash('HEX').toLowerCase() ===
            user.password;
          if (success) {
            // migrate sha256 to bcrypt
            await ctx.db.sSOUser.update({
              where: {
                id: user.id,
              },
              data: {
                hashAlgorithm: 'bcrypt',
                password: await bcrypt.hash(
                  password,
                  await bcrypt.genSalt()
                ),
              },
            });
          }
        }
        if (success) {
          if (user.member.memberType === 'Explusion')
            return {
              success: false,
              errorMessage:
                '탈퇴 및 제적처리된 회원입니다. 재입부 신청해주시거나 회장단에게 문의해주세요.',
            };
          else if (user.member.memberType === 'Removed')
            return {
              success: false,
              errorMessage:
                '제명된 회원입니다. 회장단에게 문의해주세요.',
            };
          const token = (
            await ctx.db.graphQlSession.create({
              data: {
                expiresAt: new Date(
                  Date.now() + 1000 * 60 * 60
                ),
                ssoUser: {
                  connect: {
                    id: user.id,
                  },
                },
              },
            })
          ).id;
          return {
            success: true,
            token,
          };
        } else {
          return {
            success: false,
            errorMessage:
              '아이디나 비밀번호가 올바르지 않습니다.',
          };
        }
      },
    });
  },
});
