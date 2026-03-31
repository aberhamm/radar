import { GetStaticPaths, GetStaticProps } from 'next';
import { SitecoreContext } from '@sitecore-jss/sitecore-jss-nextjs';

export default function CatchAll({ layoutData }: { layoutData: any }) {
  return (
    <SitecoreContext layoutData={layoutData}>
      <main>
        <div id="content" />
      </main>
    </SitecoreContext>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  return { paths: [], fallback: 'blocking' };
};

export const getStaticProps: GetStaticProps = async (context) => {
  const path = context.params?.path as string[];
  return { props: { layoutData: {} }, revalidate: 60 };
};
